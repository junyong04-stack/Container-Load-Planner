import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

const XML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const parser = new DOMParser();
const serializer = new XMLSerializer();

function elements(parent, name) {
  return Array.from(parent.getElementsByTagName(name));
}

function first(parent, name) {
  return elements(parent, name)[0];
}

function shiftReference(ref, fromRow, offset) {
  return ref.replace(/(\$?[A-Z]+\$?)(\d+)/g, (match, column, value) => {
    const row = Number(value);
    return row >= fromRow ? `${column}${row + offset}` : match;
  });
}

function findCell(sheet, ref) {
  return elements(sheet, "c").find((cell) => cell.getAttribute("r") === ref);
}

function removeChildren(cell) {
  while (cell.firstChild) cell.removeChild(cell.firstChild);
}

function setInlineString(sheet, ref, value) {
  const cell = findCell(sheet, ref);
  if (!cell) throw new Error(`Order Form template cell ${ref} is missing.`);
  removeChildren(cell);
  cell.setAttribute("t", "inlineStr");
  const inline = sheet.createElementNS(XML_NS, "is");
  const text = sheet.createElementNS(XML_NS, "t");
  text.setAttribute("xml:space", "preserve");
  text.appendChild(sheet.createTextNode(value));
  inline.appendChild(text);
  cell.appendChild(inline);
}

function setNumber(sheet, ref, value) {
  const cell = findCell(sheet, ref);
  if (!cell) throw new Error(`Order Form template cell ${ref} is missing.`);
  removeChildren(cell);
  cell.removeAttribute("t");
  const number = sheet.createElementNS(XML_NS, "v");
  number.appendChild(sheet.createTextNode(String(value)));
  cell.appendChild(number);
}

function setBlank(sheet, ref) {
  const cell = findCell(sheet, ref);
  if (!cell) throw new Error(`Order Form template cell ${ref} is missing.`);
  removeChildren(cell);
  cell.removeAttribute("t");
}

function setFormula(sheet, ref, formula) {
  const cell = findCell(sheet, ref);
  if (!cell) throw new Error(`Order Form template cell ${ref} is missing.`);
  removeChildren(cell);
  cell.removeAttribute("t");
  const formulaNode = sheet.createElementNS(XML_NS, "f");
  formulaNode.appendChild(sheet.createTextNode(formula));
  cell.appendChild(formulaNode);
}

function excelDate(value) {
  return (Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) - Date.UTC(1899, 11, 30)) / 86400000;
}

function clearOrderRow(sheet, row) {
  setInlineString(sheet, `C${row}`, "");
  setBlank(sheet, `D${row}`);
  setInlineString(sheet, `G${row}`, "");
  setNumber(sheet, `B${row}`, row - 18);
}

function expandOrderRows(sheet, extraRows) {
  if (extraRows <= 0) return;
  const sheetData = first(sheet, "sheetData");
  const templateRow = elements(sheetData, "row").find((row) => row.getAttribute("r") === "23");
  if (!sheetData || !templateRow) throw new Error("Unable to expand the Order Form product area safely.");

  elements(sheetData, "row").filter((row) => Number(row.getAttribute("r")) >= 24).reverse().forEach((row) => {
    const next = Number(row.getAttribute("r")) + extraRows;
    row.setAttribute("r", String(next));
    elements(row, "c").forEach((cell) => {
      const ref = cell.getAttribute("r");
      if (ref) cell.setAttribute("r", shiftReference(ref, 24, extraRows));
    });
  });

  const nextExistingRow = elements(sheetData, "row").find((row) => Number(row.getAttribute("r")) === 24 + extraRows) ?? null;
  for (let index = 0; index < extraRows; index += 1) {
    const rowNumberValue = 24 + index;
    const clone = templateRow.cloneNode(true);
    clone.setAttribute("r", String(rowNumberValue));
    elements(clone, "c").forEach((cell) => {
      const ref = cell.getAttribute("r");
      if (ref) cell.setAttribute("r", ref.replace(/\d+$/, String(rowNumberValue)));
    });
    sheetData.insertBefore(clone, nextExistingRow);
  }

  const mergeCells = first(sheet, "mergeCells");
  if (!mergeCells) throw new Error("Order Form merge-cell definitions are missing.");
  elements(mergeCells, "mergeCell").forEach((merge) => {
    const ref = merge.getAttribute("ref");
    if (ref) merge.setAttribute("ref", shiftReference(ref, 24, extraRows));
  });
  for (let row = 24; row < 24 + extraRows; row += 1) {
    for (const ref of [`D${row}:E${row}`, `G${row}:H${row}`]) {
      const merge = sheet.createElementNS(XML_NS, "mergeCell");
      merge.setAttribute("ref", ref);
      mergeCells.appendChild(merge);
    }
  }
  mergeCells.setAttribute("count", String(elements(mergeCells, "mergeCell").length));

  const dimension = first(sheet, "dimension");
  if (dimension) dimension.setAttribute("ref", shiftReference(dimension.getAttribute("ref") || "A4:H37", 24, extraRows));
}

export async function buildOrderForm(input) {
  if (!input.lines.length) throw new Error("No calculated order lines are available.");
  const zip = await JSZip.loadAsync(input.template);
  const sheetFile = zip.file("xl/worksheets/sheet1.xml");
  const workbookFile = zip.file("xl/workbook.xml");
  if (!sheetFile || !workbookFile) throw new Error("The Order Form template structure is not supported.");

  const sheet = parser.parseFromString(await sheetFile.async("string"), "application/xml");
  const workbook = parser.parseFromString(await workbookFile.async("string"), "application/xml");
  const extraRows = Math.max(0, input.lines.length - 5);
  expandOrderRows(sheet, extraRows);
  const lastOrderRow = 18 + Math.max(5, input.lines.length);
  const totalRow = 24 + extraRows;

  for (let row = 19; row <= lastOrderRow; row += 1) clearOrderRow(sheet, row);
  input.lines.forEach((line, index) => {
    const row = 19 + index;
    setInlineString(sheet, `C${row}`, line.model);
    setNumber(sheet, `D${row}`, line.quantity);
    setInlineString(sheet, `G${row}`, line.remark);
  });
  setInlineString(sheet, "C12", input.company?.trim() ?? "");
  setNumber(sheet, "F12", excelDate(input.orderDate));
  setInlineString(sheet, `B${26 + extraRows}`, `( 40FT HQ CNTR x ${input.containerQuantity} EA )`);
  setFormula(sheet, `D${totalRow}`, `SUM(D19:D${lastOrderRow})`);

  elements(workbook, "definedName").forEach((definedName) => {
    if (definedName.getAttribute("name") === "_xlnm.Print_Area" && definedName.textContent) {
      definedName.textContent = shiftReference(definedName.textContent, 35, extraRows);
    }
  });
  const calcPr = first(workbook, "calcPr");
  if (calcPr) {
    calcPr.setAttribute("fullCalcOnLoad", "1");
    calcPr.setAttribute("forceFullCalc", "1");
  }

  zip.file("xl/worksheets/sheet1.xml", serializer.serializeToString(sheet));
  zip.file("xl/workbook.xml", serializer.serializeToString(workbook));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
