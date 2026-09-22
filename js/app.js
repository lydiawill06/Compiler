(() => {
  "use strict";

  const fileInput = document.getElementById("file-input");
  const fileDrop = document.getElementById("file-drop");
  const fileListEl = document.getElementById("file-list");
  const statusEl = document.getElementById("status");
  const matchPanel = document.getElementById("match-panel");
  const matchColumnsEl = document.getElementById("match-columns");
  const compileBtn = document.getElementById("compile-btn");
  const selectAllBtn = document.getElementById("select-all-btn");
  const suggestBtn = document.getElementById("suggest-btn");
  const clearBtn = document.getElementById("clear-btn");
  const previewPanel = document.getElementById("preview-panel");
  const exportPanel = document.getElementById("export-panel");
  const previewTable = document.getElementById("preview-table");
  const statsEl = document.getElementById("stats");
  const summaryHint = document.getElementById("summary-hint");
  const exportBtn = document.getElementById("export-btn");
  const exportCsvBtn = document.getElementById("export-csv-btn");

  const PREVIEW_ROW_LIMIT = 500;

  // Each entry: { name, rows }
  const filesData = [];
  let columnInfo = null;
  let selectedKeys = new Set();
  // Result of the last compile, kept for export.
  let compiled = null;

  function setStatus(message, isError) {
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", Boolean(isError));
  }

  function readFileAsRows(file) {
    const isCsv = /\.csv$/i.test(file.name);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
      reader.onload = () => {
        try {
          const workbook = isCsv
            ? XLSX.read(reader.result, { type: "string" })
            : XLSX.read(reader.result, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          resolve(XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }));
        } catch (err) {
          reject(err);
        }
      };
      if (isCsv) {
        reader.readAsText(file);
      } else {
        reader.readAsArrayBuffer(file);
      }
    });
  }

  // --- File list & match-column selection ----------------------------------------

  function renderFileList() {
    fileListEl.innerHTML = "";
    filesData.forEach((entry, index) => {
      const li = document.createElement("li");

      const meta = document.createElement("span");
      meta.className = "file-meta";
      meta.textContent = entry.name;
      li.appendChild(meta);

      const count = document.createElement("span");
      count.className = "row-count";
      const colCount = columnInfo ? columnInfo.fileColumns[index].length : 0;
      count.textContent = `${entry.rows.length} rows · ${colCount} columns`;
      li.appendChild(count);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => {
        filesData.splice(index, 1);
        filesChanged();
      });
      li.appendChild(removeBtn);

      fileListEl.appendChild(li);
    });
  }

  function renderMatchColumns() {
    matchColumnsEl.innerHTML = "";
    columnInfo.columns.forEach((column) => {
      const label = document.createElement("label");
      label.className = "chip";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = selectedKeys.has(column.key);
      box.addEventListener("change", () => {
        if (box.checked) selectedKeys.add(column.key);
        else selectedKeys.delete(column.key);
        hideResults();
      });
      label.appendChild(box);
      label.appendChild(document.createTextNode(` ${column.label}`));
      const inFiles = document.createElement("span");
      inFiles.className = "chip-count";
      inFiles.textContent = `${column.files.length}/${filesData.length}`;
      inFiles.title = `Present in ${column.files.length} of ${filesData.length} file(s)`;
      label.appendChild(inFiles);
      matchColumnsEl.appendChild(label);
    });
  }

  function useSuggestedColumns() {
    selectedKeys = new Set(Compiler.suggestMatchColumns(filesData, columnInfo));
  }

  function filesChanged() {
    hideResults();
    if (filesData.length === 0) {
      columnInfo = null;
      selectedKeys = new Set();
      matchPanel.hidden = true;
      renderFileList();
      setStatus("");
      return;
    }
    columnInfo = Compiler.buildColumns(filesData);
    useSuggestedColumns();
    renderFileList();
    renderMatchColumns();
    matchPanel.hidden = false;
  }

  function hideResults() {
    previewPanel.hidden = true;
    exportPanel.hidden = true;
    compiled = null;
  }

  async function handleFiles(fileList) {
    const incoming = Array.from(fileList).filter((f) => /\.(csv|xlsx|xls)$/i.test(f.name));
    if (incoming.length === 0) {
      setStatus("Please choose .csv, .xlsx, or .xls files.", true);
      return;
    }

    setStatus(`Reading ${incoming.length} file(s)...`);
    const failures = [];
    for (const file of incoming) {
      try {
        filesData.push({ name: file.name, rows: await readFileAsRows(file) });
      } catch (err) {
        failures.push(`"${file.name}": ${err.message}`);
      }
    }
    filesChanged();
    if (failures.length) {
      setStatus(`Failed to read ${failures.join("; ")}`, true);
    } else {
      setStatus(`${filesData.length} file(s) loaded. Check the match columns, then click "Compile Files".`);
    }
  }

  fileDrop.addEventListener("dragover", (e) => {
    e.preventDefault();
    fileDrop.classList.add("dragover");
  });
  fileDrop.addEventListener("dragleave", () => {
    fileDrop.classList.remove("dragover");
  });
  fileDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    fileDrop.classList.remove("dragover");
    if (e.dataTransfer && e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) {
      handleFiles(fileInput.files);
    }
    fileInput.value = "";
  });

  selectAllBtn.addEventListener("click", () => {
    selectedKeys = new Set(columnInfo.columns.map((c) => c.key));
    renderMatchColumns();
    hideResults();
  });

  suggestBtn.addEventListener("click", () => {
    useSuggestedColumns();
    renderMatchColumns();
    hideResults();
  });

  clearBtn.addEventListener("click", () => {
    filesData.length = 0;
    filesChanged();
  });

  // --- Compile & preview ----------------------------------------------------------

  function renderStats(stats) {
    statsEl.innerHTML = "";
    [
      [stats.inputRows, "rows read"],
      [stats.outputRows, "rows in result"],
      [stats.mergedRows, "copies merged"],
      [stats.newColumns, "columns added"],
      [stats.conflictCount, "conflicts"],
    ].forEach(([value, label]) => {
      const div = document.createElement("div");
      div.className = "stat";
      const strong = document.createElement("strong");
      strong.textContent = value;
      div.appendChild(strong);
      div.appendChild(document.createTextNode(label));
      statsEl.appendChild(div);
    });
  }

  function renderPreview(result) {
    const newCols = new Set(
      result.columnReport.map((c, i) => (c.isNew ? i : -1)).filter((i) => i >= 0)
    );

    previewTable.innerHTML = "";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    [...result.columns, "Times Found", "Source Files"].forEach((label, i) => {
      const th = document.createElement("th");
      th.textContent = label;
      if (newCols.has(i)) {
        th.classList.add("new-col");
        th.title = `Added by ${result.columnReport[i].addedBy}`;
      }
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    previewTable.appendChild(thead);

    const tbody = document.createElement("tbody");
    result.rows.slice(0, PREVIEW_ROW_LIMIT).forEach((row) => {
      const tr = document.createElement("tr");
      if (row.sourceCount > 1) tr.classList.add("merged");
      row.values.forEach((value, i) => {
        const td = document.createElement("td");
        td.textContent = value;
        if (row.conflicts.has(i)) {
          td.classList.add("conflict");
          td.title = row.conflicts.get(i).join("\n");
        }
        tr.appendChild(td);
      });
      const tdCount = document.createElement("td");
      tdCount.textContent = row.sourceCount;
      tr.appendChild(tdCount);
      const tdSources = document.createElement("td");
      tdSources.textContent = row.sources;
      tr.appendChild(tdSources);
      tbody.appendChild(tr);
    });
    previewTable.appendChild(tbody);

    renderStats(result.stats);
    let hint = `Compiled ${result.stats.fileCount} file(s), matching copies on: ${
      result.matchColumns.join(", ") || "(nothing — no rows merged)"
    }.`;
    if (result.stats.blankRows > 0) hint += ` ${result.stats.blankRows} blank row(s) skipped.`;
    if (result.rows.length > PREVIEW_ROW_LIMIT) {
      hint += ` Showing the first ${PREVIEW_ROW_LIMIT} of ${result.rows.length} rows; the export includes all of them.`;
    }
    summaryHint.textContent = hint;

    previewPanel.hidden = false;
    exportPanel.hidden = false;
  }

  compileBtn.addEventListener("click", () => {
    if (filesData.length === 0) return;
    try {
      compiled = Compiler.compile(filesData, Array.from(selectedKeys), columnInfo);
      renderPreview(compiled);
      setStatus("Compiled successfully.");
    } catch (err) {
      setStatus(`Error compiling files: ${err.message}`, true);
    }
  });

  // --- Export -----------------------------------------------------------------------

  const COLORS = {
    header: "FF2F6FED",
    newHeader: "FF7B4FD6",
    merged: "FFEAF1FE",
    conflict: "FFFFF3C4",
    border: "FFDDE1E7",
  };

  function fill(argb) {
    return { type: "pattern", pattern: "solid", fgColor: { argb } };
  }

  function addTableSheet(workbook, name, headers, rows) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = headers.map((label) => ({
      header: label,
      width: Math.min(Math.max(String(label).length + 4, 14), 50),
    }));
    rows.forEach((r) => sheet.addRow(r));

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = fill(COLORS.header);
    headerRow.alignment = { vertical: "middle" };
    if (headers.length > 0) {
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
    }
    return sheet;
  }

  function applyBorders(sheet) {
    const side = { style: "thin", color: { argb: COLORS.border } };
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = { top: side, left: side, bottom: side, right: side };
      });
    });
  }

  async function exportWorkbook() {
    if (!compiled) return;
    const result = compiled;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Data Compiler";
    workbook.created = new Date();

    const data = addTableSheet(
      workbook,
      "Compiled Data",
      [...result.columns, "Times Found", "Source Files"],
      result.rows.map((r) => [...r.values, r.sourceCount, r.sources])
    );
    result.columnReport.forEach((c, i) => {
      if (c.isNew) {
        const cell = data.getRow(1).getCell(i + 1);
        cell.fill = fill(COLORS.newHeader);
        cell.note = `Column added by ${c.addedBy}`;
      }
    });
    result.rows.forEach((row, r) => {
      const excelRow = data.getRow(r + 2);
      if (row.sourceCount > 1) {
        for (let c = 1; c <= result.columns.length + 2; c++) {
          excelRow.getCell(c).fill = fill(COLORS.merged);
        }
      }
      row.conflicts.forEach((values, i) => {
        const cell = excelRow.getCell(i + 1);
        cell.fill = fill(COLORS.conflict);
        cell.note = `Copies disagreed:\n${values.join("\n")}`;
      });
    });
    applyBorders(data);

    applyBorders(
      addTableSheet(
        workbook,
        "Duplicates",
        [`Matched On (${result.matchColumns.join(", ")})`, "Times Found", "Files", "Found At"],
        result.duplicates.map((d) => [d.match, d.count, d.files.join(", "), d.sources])
      )
    );

    applyBorders(
      addTableSheet(
        workbook,
        "Conflicts",
        ["Record", "Column", "Value Kept", "All Values Found"],
        result.conflicts.map((c) => [c.match, c.column, c.kept, c.values.join("\n")])
      )
    );

    const columnsSheet = addTableSheet(
      workbook,
      "Columns",
      ["Column", "Added By", "New Column?", "Found In"],
      result.columnReport.map((c) => [c.column, c.addedBy, c.isNew ? "Yes" : "No", c.files.join(", ")])
    );
    applyBorders(columnsSheet);

    const buffer = await workbook.xlsx.writeBuffer();
    download(
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      "xlsx"
    );
  }

  function exportCsv() {
    if (!compiled) return;
    const aoa = [
      [...compiled.columns, "Times Found", "Source Files"],
      ...compiled.rows.map((r) => [...r.values, r.sourceCount, r.sources]),
    ];
    const csv = XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(aoa));
    download(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), "csv");
  }

  function download(blob, extension) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compiled_data_${new Date().toISOString().slice(0, 10)}.${extension}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  exportBtn.addEventListener("click", () => {
    exportWorkbook().catch((err) => setStatus(`Export failed: ${err.message}`, true));
  });
  exportCsvBtn.addEventListener("click", () => {
    try {
      exportCsv();
    } catch (err) {
      setStatus(`Export failed: ${err.message}`, true);
    }
  });
})();
