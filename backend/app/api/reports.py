# app/api/reports.py
# Generación de reportes (PDF y Excel) en el servidor.
#
# El frontend envía un resumen de los datos ya calculados (point-in-polygon
# en el navegador) y el backend renderiza el archivo final con ReportLab (PDF)
# u openpyxl (Excel). Esto evita los falsos positivos de antivirus que
# provocaba jsPDF al generar el binario en el cliente.
import base64
import io
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from pydantic import BaseModel, Field
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as _canvas
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from starlette.concurrency import run_in_threadpool

from app.api.deps import auth_guard
from app.models.user import CurrentUser

router = APIRouter(prefix="/api/v1/reports", tags=["Reports"])

logger = logging.getLogger("app.api.reports")

# Colores corporativos (coinciden con los del reporte anterior en jsPDF).
PRIMARY = colors.HexColor("#1A365D")
SECONDARY = colors.HexColor("#3182CE")
GREY_BORDER = colors.HexColor("#B4B4B4")
LIGHT_GREY = colors.HexColor("#F0F0F0")
FOOTER_LINE = colors.HexColor("#C8C8C8")
FOOTER_TEXT = colors.HexColor("#646464")

MARGIN = 14 * mm
PAGE_W, PAGE_H = A4

# Claves de atributo que se excluyen del detalle Excel (igual que en el cliente).
_EXCLUDED_KEYS = {"id", "geoid", "gid", "objectid"}


class ReportRequest(BaseModel):
    etiqueta: Literal["Estado", "Bloque", "Área", "Intersección"] = "Estado"
    nombre: str = Field(default="Reporte", max_length=120)
    total: int = 0
    detalle: Dict[str, List[Dict[str, Any]]] = Field(default_factory=dict)
    logo_base64: Optional[str] = None
    # Captura JPEG (data URL o base64) del mapa con el análisis resaltado.
    mapa_base64: Optional[str] = None


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
def _sanitize_filename(name: str) -> str:
    name = (name or "").strip() or "reporte"
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name)
    name = name.replace("..", "_")
    name = re.sub(r"\s+", "_", name)
    return name[:80] or "reporte"


def _content_disposition(filename: str) -> str:
    # filename en ASCII (safe) + filename* para acentos (RFC 5987).
    ascii_name = re.sub(r"[^\x00-\x7f]+", "_", filename) or "reporte"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


def _decode_logo(logo_base64: Optional[str]) -> Optional[bytes]:
    if not logo_base64:
        return None
    try:
        data = logo_base64.split(",", 1)[1] if "," in logo_base64 else logo_base64
        return base64.b64decode(data)
    except Exception:
        return None


def _decode_image(image_base64: Optional[str]) -> Optional[bytes]:
    """Decodifica una imagen base64/data-URL con un tope de tamaño."""
    if not image_base64:
        return None
    # ~12 MB de base64 equivalen a ~9 MB de imagen: suficiente para un JPEG.
    if len(image_base64) > 12_000_000:
        return None
    try:
        data = image_base64.split(",", 1)[1] if "," in image_base64 else image_base64
        raw = base64.b64decode(data, validate=False)
        if len(raw) > 9 * 1024 * 1024:
            return None
        return raw
    except Exception:
        return None


def _is_excluded(key: str) -> bool:
    lk = key.lower()
    return lk in _EXCLUDED_KEYS or lk.endswith("_id") or lk.startswith("id_")


def _sanitize_sheet_name(name: str) -> str:
    name = re.sub(r"[\\/:*?\[\]]", "_", name)
    name = name.strip()[:31] or "Hoja"
    return name


# ---------------------------------------------------------------------------
# PDF (ReportLab)
# ---------------------------------------------------------------------------
class NumberedCanvas(_canvas.Canvas):
    """Canvas que dibuja el pie de página con 'Página X de Y'."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self._draw_footer(total)
            super().showPage()
        super().save()

    def _draw_footer(self, total: int):
        fecha = datetime.now().strftime("%d/%m/%Y")
        self.saveState()
        self.setStrokeColor(FOOTER_LINE)
        self.setLineWidth(0.3)
        self.line(MARGIN, 12 * mm, PAGE_W - MARGIN, 12 * mm)
        self.setFont("Helvetica", 7)
        self.setFillColor(FOOTER_TEXT)
        self.drawRightString(PAGE_W - MARGIN, 6 * mm, f"Página {self._pageNumber} de {total}")
        self.drawString(MARGIN, 6 * mm, f"Generado: {fecha}")
        self.restoreState()


def _build_pdf(req: ReportRequest, stats: Optional[Dict[str, Any]] = None) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=MARGIN,
        leftMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=18 * mm,
        title=f"Reporte Estratégico de Datos - {req.nombre}",
        author="BSD",
        subject=f"{req.etiqueta}: {req.nombre}",
        creator="BSD",
    )

    story = []

    # Logo (opcional).
    logo_bytes = _decode_logo(req.logo_base64)
    if logo_bytes is not None:
        story.append(Image(io.BytesIO(logo_bytes), width=35 * mm, height=12 * mm))
        story.append(Spacer(1, 4 * mm))

    # Banda de cabecera: título + subtítulo.
    title_style = ParagraphStyle(
        "ReportTitle", fontName="Helvetica-Bold", fontSize=16,
        textColor=colors.white, alignment=TA_CENTER, leading=20,
    )
    subtitle_style = ParagraphStyle(
        "ReportSubtitle", fontName="Helvetica", fontSize=11,
        textColor=colors.white, alignment=TA_CENTER, leading=14,
    )
    band = Table(
        [
            [Paragraph("Reporte Estratégico de Datos", title_style)],
            [Paragraph(f"{req.etiqueta}: {req.nombre}", subtitle_style)],
        ],
        colWidths=[PAGE_W - 2 * MARGIN],
    )
    band.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PRIMARY),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, -1), (-1, -1), 1.5, SECONDARY),
    ]))
    story.append(band)
    story.append(Spacer(1, 6 * mm))

    # Tabla resumen: capa -> cantidad.
    filas = [[capa, str(len(lista or []))] for capa, lista in (req.detalle or {}).items()]
    table_data = [["Capa / Elemento", "Cantidad"]] + filas
    summary = Table(table_data, colWidths=[PAGE_W - 2 * MARGIN - 30 * mm, 30 * mm])
    summary.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), SECONDARY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.2, GREY_BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_GREY]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(summary)
    story.append(Spacer(1, 6 * mm))

    # Total general.
    total_style = ParagraphStyle(
        "Total", fontName="Helvetica-Bold", fontSize=11,
        textColor=PRIMARY, leading=14,
    )
    story.append(Paragraph(f"Total general de elementos: {req.total}", total_style))
    story.append(Spacer(1, 5 * mm))

    # Imagen del mapa con la capa del análisis y los puntos resaltados.
    mapa_bytes = _decode_image(req.mapa_base64)
    if mapa_bytes:
        try:
            iw, ih = ImageReader(io.BytesIO(mapa_bytes)).getSize()
            max_w = PAGE_W - 2 * MARGIN
            max_h = 105 * mm
            escala = min(max_w / iw, max_h / ih)
            caption_style = ParagraphStyle(
                "MapCaption", fontName="Helvetica-Bold", fontSize=10,
                textColor=PRIMARY, leading=13,
            )
            story.append(Paragraph("Mapa del análisis", caption_style))
            story.append(Spacer(1, 2 * mm))
            story.append(Image(
                io.BytesIO(mapa_bytes),
                width=iw * escala,
                height=ih * escala,
            ))
            if stats is not None:
                stats["has_map"] = True
        except Exception as e:
            logger.warning("No se pudo incrustar la imagen del mapa en el PDF: %s", e)

    doc.build(story, canvasmaker=NumberedCanvas)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Excel (openpyxl)
# ---------------------------------------------------------------------------
def _build_excel(req: ReportRequest) -> bytes:
    wb = Workbook()
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="3182CE")

    # --- Hoja "Resumen General" ---
    ws = wb.active
    ws.title = "Resumen General"
    ws.append(["Capa / Elemento", "Cantidad"])
    for capa, lista in (req.detalle or {}).items():
        ws.append([capa, len(lista or [])])
    for cell in ws[1]:
        cell.font = header_font
        cell.fill = header_fill

    # --- Hojas de detalle (una por capa) ---
    used_names = {"resumen general"}
    for capa, lista in (req.detalle or {}).items():
        if not lista:
            continue

        # Unión ordenada de claves no excluidas (orden de primera aparición).
        headers = ["#"]
        for props in lista:
            for key in props:
                if key not in headers and not _is_excluded(key):
                    headers.append(key)

        display = _sanitize_sheet_name(capa)
        sheet_name = display
        sheet_key = display.lower()
        n = 2
        while sheet_key in used_names:
            sheet_name = f"{display[:28]}_{n}"
            sheet_key = sheet_name.lower()
            n += 1
        used_names.add(sheet_key)

        ws_det = wb.create_sheet(title=sheet_name)
        ws_det.append(headers)
        for cell in ws_det[1]:
            cell.font = header_font
            cell.fill = header_fill

        for i, props in enumerate(lista, start=1):
            row = [i]
            for key in headers[1:]:
                v = props.get(key)
                row.append(v if v is not None else "")
            ws_det.append(row)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/pdf")
async def generate_pdf_report(req: ReportRequest, user: CurrentUser = Depends(auth_guard)):
    stats: Dict[str, Any] = {}
    try:
        pdf = await run_in_threadpool(_build_pdf, req, stats)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al generar el PDF: {e}")

    filename = f"Reporte_Datos_{_sanitize_filename(req.nombre)}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": _content_disposition(filename),
            "X-Content-Type-Options": "nosniff",
            "X-Report-Has-Map": "1" if stats.get("has_map") else "0",
        },
    )


@router.post("/excel")
async def generate_excel_report(req: ReportRequest, user: CurrentUser = Depends(auth_guard)):
    try:
        data = await run_in_threadpool(_build_excel, req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al generar el Excel: {e}")

    filename = f"Reporte_Puntos_{_sanitize_filename(req.nombre)}.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": _content_disposition(filename),
            "X-Content-Type-Options": "nosniff",
        },
    )
