# Compiler
Combines multiple files of data

A browser-based tool that combines any number of CSV/Excel files into one
table. It spots rows that are copies of the same record (within a file or
across files), merges them into a single row, and adds new columns as needed
when files don't share the same layout.

Runs entirely client-side (no server, no upload) using [SheetJS](https://sheetjs.com/)
to read CSV/XLSX files and [ExcelJS](https://github.com/exceljs/exceljs) to
generate a formatted `.xlsx` download.

## How it works

- **Import**: choose or drag-and-drop any number of `.csv`, `.xlsx`, or `.xls`
  files. The first sheet of each workbook is used, with its first row as the
  headers.
- **Columns**: the result has every column from every file. Headers that
  differ only in case or spacing (`Customer ID` vs `customer id `) are treated
  as the same column. Columns keep the first file's order; any column that
  first appears in a later file is added to the end.
- **Spotting copies**: pick which columns identify a record. Rows with the
  same values in every checked column (ignoring case and extra spaces) are
  copies and get merged into one row. The tool suggests a default:
  - an ID-like column (`ID`, `Email`, `Code`, `SKU`, …) that is in every file
    and identifies one row per value, if there is one;
  - otherwise every column the files have in common.

  Check every column to only merge rows that are exact copies. Rows that are
  blank in all the checked columns are never merged.
- **Merging**: blank cells are filled in from whichever copy has a value. When
  copies disagree (e.g. `Denver` vs `Seattle`), the value from the first file
  is kept and the disagreement is flagged as a conflict.
- **Export**: downloads a styled `.xlsx` workbook with:
  - **Compiled Data**: the merged table, plus "Times Found" and "Source Files"
    columns. Merged rows are shaded blue, conflicting cells are yellow (with a
    note listing every value found), and columns added by a later file have a
    purple header.
  - **Duplicates**: every record found more than once, and where.
  - **Conflicts**: every cell where copies disagreed, with all the values.
  - **Columns**: every column, which file added it, and which files have it.

  The compiled table can also be exported as a plain `.csv`.

Try it with the two files in [`samples/`](samples/).

## Running locally

No build step or install required. Serve the folder with any static file
server and open it in a browser, for example:

```
python -m http.server 8080
```

Then visit `http://localhost:8080`.

## Code layout

- `js/compiler.js`: the merge logic (column union, copy detection, conflicts),
  with no page code in it.
- `js/app.js`: the page: file loading, the match-column picker, preview, and
  export.
