# app/services/diccionario_export.py
"""
Exportación del diccionario de datos GIS a Excel (.xlsx).

Replica la estructura del libro generado con DicoGIS:
    Resumen · Capas · Calidad · Campos

Solo depende de openpyxl (ya presente en requirements).
"""
from __future__ import annotations

import io
from datetime import datetime
from typing import Any, Dict, List

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

CAB = Font(bold=True, color="FFFFFF")
FONDO_CAB = PatternFill("solid", fgColor="1F4E79")
VERDE = PatternFill("solid", fgColor="C6EFCE")
AMBAR = PatternFill("solid", fgColor="FFEB9C")
ROJO = PatternFill("solid", fgColor="FFC7CE")
WRAP = Alignment(wrap_text=True, vertical="top")


def _header(ws, headers: List[str], widths: List[int]) -> None:
    for idx, (title, width) in enumerate(zip(headers, widths), start=1):
        cell = ws.cell(row=1, column=idx, value=title)
        cell.font = CAB
        cell.fill = FONDO_CAB
        cell.alignment = Alignment(wrap_text=True, vertical="center")
        ws.column_dimensions[get_column_letter(idx)].width = width
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{max(ws.max_row, 1)}"


def _yesno(value: Any) -> str:
    if value is None or value == "":
        return "—"
    return "sí" if bool(value) else "no"


def build_workbook(data: Dict[str, Any]) -> bytes:
    layers: List[Dict[str, Any]] = [
        layer for schema in data.get("schemas", []) for layer in schema.get("layers", [])
    ]
    totals = data.get("totals", {})
    db = data.get("database", {})
    generated = data.get("generated_at", "")

    wb = Workbook()

    # ------------------------------------------------------------------
    # Resumen
    # ------------------------------------------------------------------
    ws = wb.active
    ws.title = "Resumen"
    ws.column_dimensions["A"].width = 38
    ws.column_dimensions["B"].width = 88

    empty = [layer for layer in layers if layer["features"] == 0]
    no_meta = [layer for layer in layers if not layer["has_metadata"]]
    no_title = [layer for layer in layers if not layer.get("title")]
    mismatched = [
        layer for layer in layers
        if layer.get("declared_features") is not None
        and int(layer["declared_features"]) != layer["features"]
    ]
    undocumented = totals.get("fields_undocumented", 0)

    rows = [
        ("Diccionario de datos GIS", "Catálogo de campos de los esquemas gis_*"),
        ("Generado", generated),
        ("Base de datos", db.get("name") or "—"),
        ("PostgreSQL", db.get("version") or "—"),
        ("PostGIS", db.get("postgis") or "—"),
        ("Prefijo de esquemas", data.get("prefix", "gis_")),
        ("Esquemas", totals.get("schemas", 0)),
        ("Capas", totals.get("layers", 0)),
        ("Objetos totales", totals.get("features", 0)),
        ("Campos totales", totals.get("fields", 0)),
        ("Campos documentados", totals.get("fields_documented", 0)),
        ("Campos sin documentar", undocumented),
        ("Capas con metadatos", totals.get("layers_with_metadata", 0)),
        ("Capas vacías", len(empty)),
        ("Capas con conteo discordante", len(mismatched)),
    ]
    for idx, (label, value) in enumerate(rows, start=1):
        ws.cell(row=idx, column=1, value=label).font = Font(bold=True)
        ws.cell(row=idx, column=2, value=value)
    ws["A1"].font = Font(bold=True, size=14)

    def _append_list(start: int, title: str, items: List[Dict[str, Any]]) -> int:
        ws.cell(row=start, column=1, value=title).font = Font(bold=True, color="9C0006")
        row = start
        for item in items:
            row += 1
            ws.cell(row=row, column=1, value=f"{item['schema']}.{item['table']}")
            ws.cell(row=row, column=2, value="; ".join(item.get("warnings") or []))
        return row + 2

    cursor = len(rows) + 2
    cursor = _append_list(cursor, f"Capas vacías ({len(empty)})", empty)
    cursor = _append_list(cursor, f"Capas sin metadatos ({len(no_meta)})", no_meta)
    cursor = _append_list(cursor, f"Capas sin título ({len(no_title)})", no_title)
    _append_list(cursor, f"Conteos discordantes ({len(mismatched)})", mismatched)

    # ------------------------------------------------------------------
    # Capas
    # ------------------------------------------------------------------
    wc = wb.create_sheet("Capas")
    headers = [
        "Nombre de la capa", "Esquema", "Descripción (comentario)", "Título",
        "Resumen", "Palabras clave", "Licencia", "Tipo de geometría", "SRS",
        "EPSG", "Extensión (SRS nativo)", "# atributos", "# objetos",
        "Objetos declarados", "Diferencia", "Diagnóstico",
    ]
    widths = [46, 16, 40, 30, 70, 28, 22, 16, 26, 7, 36, 8, 10, 10, 9, 50]
    _header(wc, headers, widths)
    for layer in layers:
        extent = layer.get("extent")
        declared = layer.get("declared_features")
        difference = (layer["features"] - int(declared)) if declared is not None else None
        wc.append([
            f"{layer['schema']}.{layer['table']}",
            layer["schema"],
            layer.get("comment") or "",
            layer.get("title") or "",
            layer.get("abstract") or "",
            layer.get("keywords") or "",
            layer.get("license") or "",
            layer.get("geom") or "",
            layer.get("srs") or "",
            layer.get("epsg"),
            ", ".join(str(c) for c in extent) if extent else "",
            layer["fields_total"],
            layer["features"],
            declared,
            difference,
            "; ".join(layer.get("warnings") or []) or "OK",
        ])
    for row in wc.iter_rows(min_row=2, max_row=wc.max_row):
        diag = row[-1].value
        fill = VERDE if diag == "OK" else (ROJO if row[12].value == 0 else AMBAR)
        for cell in row:
            cell.alignment = WRAP
        row[-1].fill = fill

    # ------------------------------------------------------------------
    # Calidad
    # ------------------------------------------------------------------
    wq = wb.create_sheet("Calidad")
    headers = [
        "Esquema", "Tabla", "Objetos reales", "Objetos declarados", "Diferencia",
        "Campos reales", "Campos documentados", "Tiene título", "Comentario en BD",
        "Tiene metadatos", "Diagnóstico",
    ]
    widths = [16, 46, 9, 10, 9, 8, 10, 8, 10, 10, 64]
    _header(wq, headers, widths)
    for layer in layers:
        declared = layer.get("declared_features")
        difference = (layer["features"] - int(declared)) if declared is not None else None
        wq.append([
            layer["schema"], layer["table"], layer["features"], declared, difference,
            layer["fields_total"], layer["fields_documented"],
            _yesno(layer.get("title")), "sí" if layer.get("comment") else "no",
            _yesno(layer.get("has_metadata")),
            "; ".join(layer.get("warnings") or []) or "OK",
        ])
    for row in wq.iter_rows(min_row=2, max_row=wq.max_row):
        diag = row[-1].value
        for cell in row:
            cell.alignment = WRAP
        row[-1].fill = VERDE if diag == "OK" else (ROJO if row[2].value == 0 else AMBAR)

    # ------------------------------------------------------------------
    # Campos
    # ------------------------------------------------------------------
    wf = wb.create_sheet("Campos")
    headers = [
        "Esquema", "Tabla", "Capa", "Campo", "Rol", "Tipo", "Longitud",
        "Precisión", "Nulos", "Únicos", "Documentado", "Tipo documentado",
        "Ejemplo", "Comentario en BD",
    ]
    widths = [16, 42, 30, 28, 10, 22, 8, 8, 7, 7, 11, 16, 34, 40]
    _header(wf, headers, widths)
    for layer in layers:
        for field in layer.get("fields", []):
            wf.append([
                layer["schema"], layer["table"], layer.get("title") or "",
                field["name"], field.get("role"), field.get("type"),
                field.get("length"), field.get("precision"),
                _yesno(field.get("nullable")), _yesno(field.get("doc_uniques")),
                "sí" if field.get("documented") else "no",
                field.get("doc_type"), field.get("doc_example"),
                field.get("comment") or "",
            ])
    for row in wf.iter_rows(min_row=2, max_row=wf.max_row):
        row[10].alignment = WRAP
        if row[10].value == "no":
            row[10].fill = AMBAR

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def filename(prefix: str = "diccionario_geoportal") -> str:
    return f"{prefix}_{datetime.now():%Y%m%d_%H%M}.xlsx"
