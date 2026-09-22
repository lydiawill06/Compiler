// Core merge logic, kept free of DOM code so it can be tested on its own.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Compiler = factory();
  }
})(typeof self !== "undefined" ? self : this, () => {
  "use strict";

  function normalizeHeader(header) {
    return String(header)
      .replace(/ /g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function cleanValue(value) {
    if (value === undefined || value === null) return "";
    return String(value).replace(/ /g, " ").replace(/\s+/g, " ").trim();
  }

  // Values are compared ignoring case and extra whitespace.
  function normalizeValue(value) {
    return cleanValue(value).toLowerCase();
  }

  // SheetJS names blank header cells "__EMPTY", "__EMPTY_1", ...
  function isBlankHeader(header) {
    return /^__EMPTY(_\d+)?$/.test(header);
  }

  // --- Columns ------------------------------------------------------------------

  // Builds the union of every file's columns. Headers that differ only by case
  // or whitespace are treated as the same column. Columns keep the order of the
  // first file; any column first seen in a later file is appended at the end.
  //
  // Returns:
  //   columns: [{ key, label, files: [fileIndex], addedBy: fileIndex }]
  //   fileColumns: per file, a list of [columnKey, originalHeader] pairs
  function buildColumns(files) {
    const columns = [];
    const byKey = new Map();
    const fileColumns = [];

    files.forEach((file, fileIndex) => {
      const headers = [];
      const seenInFile = new Set();
      for (const row of file.rows) {
        for (const header of Object.keys(row)) {
          if (!seenInFile.has(header)) {
            seenInFile.add(header);
            headers.push(header);
          }
        }
      }

      const pairs = [];
      const usedKeys = new Set();
      let unnamedCount = 0;
      for (const header of headers) {
        let label = header;
        if (isBlankHeader(header)) {
          const hasData = file.rows.some((row) => cleanValue(row[header]) !== "");
          if (!hasData) continue;
          unnamedCount++;
          label = `Unnamed ${unnamedCount}`;
        }
        let key = normalizeHeader(label);
        // Two headers in the same file that normalize alike ("Name" and "name")
        // stay separate columns so no data is lost.
        let suffix = 2;
        while (usedKeys.has(key)) {
          key = `${normalizeHeader(label)} (${suffix})`;
          label = `${cleanValue(header)} (${suffix})`;
          suffix++;
        }
        usedKeys.add(key);
        pairs.push([key, header]);

        if (!byKey.has(key)) {
          const column = { key, label: cleanValue(label), files: [], addedBy: fileIndex };
          byKey.set(key, column);
          columns.push(column);
        }
        byKey.get(key).files.push(fileIndex);
      }
      fileColumns.push(pairs);
    });

    return { columns, fileColumns };
  }

  const ID_LIKE = /(^|\b|_)(id|key|code|number|no|num|email|e-mail|sku|uuid|guid)$/;

  // Picks sensible default columns to match duplicates on:
  //   1. an ID-like column present in every file whose values are filled in and
  //      unique within each file, if there is one;
  //   2. otherwise every column shared by all files;
  //   3. otherwise (nothing shared) every column, i.e. exact-copy matching.
  function suggestMatchColumns(files, columnInfo) {
    const { columns, fileColumns } = columnInfo;
    if (columns.length === 0) return [];
    const shared = columns.filter((c) => c.files.length === files.length);
    if (shared.length === 0) return columns.map((c) => c.key);

    const idCandidates = shared.filter((c) => ID_LIKE.test(c.key));
    for (const column of idCandidates) {
      let ok = true;
      files.forEach((file, fileIndex) => {
        if (!ok) return;
        const pairs = fileColumns[fileIndex];
        const header = pairs.find(([key]) => key === column.key)[1];
        // Each ID must point to one distinct row; exact copies of a row are fine.
        const rowById = new Map();
        let filled = 0;
        for (const row of file.rows) {
          const id = normalizeValue(row[header]);
          if (!id) continue;
          filled++;
          const rowSignature = pairs.map(([, h]) => normalizeValue(row[h])).join("\u0001");
          if (rowById.has(id) && rowById.get(id) !== rowSignature) ok = false;
          rowById.set(id, rowSignature);
        }
        if (file.rows.length > 0 && filled / file.rows.length < 0.9) ok = false;
      });
      if (ok) return [column.key];
    }
    return shared.map((c) => c.key);
  }

  // --- Compile --------------------------------------------------------------------

  // Merges every row of every file into one table.
  //
  // Rows whose values match on all `matchKeys` columns are treated as copies of
  // the same record and merged into a single row: blank cells are filled in from
  // whichever copy has a value, and when two copies disagree the first value is
  // kept and the disagreement is reported as a conflict. Rows that are blank in
  // every match column are never merged.
  function compile(files, matchKeys, columnInfo) {
    columnInfo = columnInfo || buildColumns(files);
    const { columns, fileColumns } = columnInfo;
    const colIndex = new Map(columns.map((c, i) => [c.key, i]));
    const matchIdx = matchKeys.filter((k) => colIndex.has(k)).map((k) => colIndex.get(k));

    const records = [];
    const bySignature = new Map();
    let inputRows = 0;
    let blankRows = 0;

    files.forEach((file, fileIndex) => {
      const pairs = fileColumns[fileIndex];
      file.rows.forEach((row, rowIndex) => {
        const source = { file: file.name, row: rowIndex + 2 }; // +2: 1-based, after header
        const values = new Array(columns.length).fill("");
        let anyValue = false;
        for (const [key, header] of pairs) {
          const v = cleanValue(row[header]);
          values[colIndex.get(key)] = v;
          if (v) anyValue = true;
        }
        if (!anyValue) {
          blankRows++;
          return;
        }
        inputRows++;

        const matchParts = matchIdx.map((i) => normalizeValue(values[i]));
        const matchable = matchParts.some((p) => p !== "");
        const signature = matchParts.join("\u0001");

        const existing = matchable ? bySignature.get(signature) : undefined;
        if (!existing) {
          const record = {
            values,
            valueSources: values.map((v) => (v ? source : null)),
            sources: [source],
            conflicts: new Map(), // column index -> [{ value, source }]
          };
          records.push(record);
          if (matchable) bySignature.set(signature, record);
          return;
        }

        existing.sources.push(source);
        values.forEach((v, i) => {
          if (!v) return;
          const current = existing.values[i];
          if (!current) {
            existing.values[i] = v;
            existing.valueSources[i] = source;
            return;
          }
          if (normalizeValue(current) === normalizeValue(v)) return;
          if (!existing.conflicts.has(i)) {
            existing.conflicts.set(i, [{ value: current, source: existing.valueSources[i] }]);
          }
          const list = existing.conflicts.get(i);
          if (!list.some((c) => normalizeValue(c.value) === normalizeValue(v))) {
            list.push({ value: v, source });
          }
        });
      });
    });

    const describe = (s) => `${s.file} (row ${s.row})`;
    const matchLabel = (record) =>
      matchIdx.map((i) => record.values[i]).filter(Boolean).join(" | ") || "(blank)";

    const rows = records.map((record) => ({
      values: record.values,
      sourceCount: record.sources.length,
      sources: record.sources.map(describe).join("; "),
      conflicts: new Map(
        Array.from(record.conflicts.entries()).map(([i, list]) => [
          i,
          list.map((c) => `${c.value}  ←  ${describe(c.source)}`),
        ])
      ),
    }));

    const duplicates = records
      .filter((r) => r.sources.length > 1)
      .map((r) => ({
        match: matchLabel(r),
        count: r.sources.length,
        files: Array.from(new Set(r.sources.map((s) => s.file))),
        sources: r.sources.map(describe).join("; "),
      }));

    const conflicts = [];
    records.forEach((record) => {
      record.conflicts.forEach((list, i) => {
        conflicts.push({
          match: matchLabel(record),
          column: columns[i].label,
          kept: record.values[i],
          values: list.map((c) => `${c.value}  ←  ${describe(c.source)}`),
        });
      });
    });

    const columnReport = columns.map((c) => ({
      column: c.label,
      addedBy: files[c.addedBy].name,
      isNew: c.addedBy > 0,
      files: c.files.map((i) => files[i].name),
    }));

    return {
      columns: columns.map((c) => c.label),
      matchColumns: matchIdx.map((i) => columns[i].label),
      rows,
      duplicates,
      conflicts,
      columnReport,
      stats: {
        fileCount: files.length,
        inputRows,
        blankRows,
        outputRows: rows.length,
        mergedRows: inputRows - rows.length,
        duplicateGroups: duplicates.length,
        conflictCount: conflicts.length,
        newColumns: columnReport.filter((c) => c.isNew).length,
      },
    };
  }

  return { normalizeHeader, normalizeValue, buildColumns, suggestMatchColumns, compile };
});
