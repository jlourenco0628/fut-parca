"""Relatório da pelada Fut Parça, criado exclusivamente a partir do JSON recebido.

Uso: python pdf_report.py --input relatorio.json --output relatorio.pdf
Também pode ser importado: generate_report(payload, caminho_pdf).
"""

from __future__ import annotations

import argparse
import json
import math
import os
from datetime import datetime
from pathlib import Path
import re
import sys
import tempfile
from xml.sax.saxutils import escape


MAX_ITEMS = 2000
MAX_INPUT_BYTES = 5 * 1024 * 1024
FINISHED = {"finished", "completed", "complete", "closed", "finalizado", "finalizada", "encerrado", "encerrada", "concluido", "concluído", "played", "done"}
CANCELLED = {"cancelled", "canceled", "cancelado", "cancelada"}
PENDING = {"scheduled", "pending", "open", "live", "in_progress", "agendado", "pendente", "aberto", "em andamento"}


def _text(value, field, default="", limit=240):
    if value is None:
        value = default
    if not isinstance(value, str):
        raise ValueError(f"{field}: use um texto.")
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value).strip()
    value = value.translate(str.maketrans({"\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-", "\u2014": "-", "\u2212": "-"}))
    if len(value) > limit:
        raise ValueError(f"{field}: máximo de {limit} caracteres.")
    return value


def _count(value, field, default=0):
    if value is None:
        value = default
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value != int(value) or value < 0 or value > 1_000_000:
        raise ValueError(f"{field}: use um inteiro entre 0 e 1000000.")
    return int(value)


def _points(value, field):
    if value is None:
        value = 0
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > 1_000_000_000:
        raise ValueError(f"{field}: pontuação numérica inválida.")
    return float(value)


def _items(data, key):
    result = data.get(key, [])
    if result is None:
        result = []
    if not isinstance(result, list) or len(result) > MAX_ITEMS:
        raise ValueError(f"{key}: use uma lista com até {MAX_ITEMS} itens.")
    if any(not isinstance(item, dict) for item in result):
        raise ValueError(f"{key}: cada item deve ser um objeto JSON.")
    return result


def _display_date(value):
    if not value:
        return "Data não informada"
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).strftime("%d/%m/%Y")
    except ValueError:
        return value


def _display_timestamp(value):
    if not value:
        return ""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        suffix = parsed.strftime(" UTC%z") if parsed.tzinfo else ""
        return parsed.strftime("%d/%m/%Y às %H:%M") + suffix
    except ValueError:
        return value


def validate_payload(data):
    """Retorna um objeto novo normalizado; não modifica o payload de origem."""
    if not isinstance(data, dict):
        raise ValueError("O relatório deve ser um objeto JSON.")
    is_closed = data.get("isClosed", False)
    if not isinstance(is_closed, bool):
        raise ValueError("isClosed: use true ou false.")
    normalized = {
        "title": _text(data.get("title"), "title", "Pelada Fut Parça"),
        "date": _text(data.get("date"), "date", limit=80),
        "modality": _text(data.get("modality"), "modality", limit=80),
        "organizer": _text(data.get("organizer"), "organizer", limit=120),
        "closedAt": _text(data.get("closedAt"), "closedAt", limit=80),
        "revision": _count(data.get("revision"), "revision", 1),
        "isClosed": is_closed,
        "matches": [], "athletes": [], "fantasy": [], "season": [],
    }
    if not normalized["title"]:
        normalized["title"] = "Pelada Fut Parça"
    for index, item in enumerate(_items(data, "matches")):
        prefix = f"matches[{index}]"
        home = _text(item.get("home"), prefix + ".home", limit=120)
        away = _text(item.get("away"), prefix + ".away", limit=120)
        if not home or not away:
            raise ValueError(f"{prefix}: informe as duas equipes.")
        raw_status = _text(item.get("status"), prefix + ".status", "finished", limit=80).lower()
        if raw_status in CANCELLED:
            status = "cancelled"
            home_score = away_score = None
        elif raw_status in FINISHED:
            status = "finished"
            if item.get("homeScore") is None or item.get("awayScore") is None:
                raise ValueError(f"{prefix}: um jogo finalizado precisa dos dois placares.")
            home_score = _count(item.get("homeScore"), prefix + ".homeScore")
            away_score = _count(item.get("awayScore"), prefix + ".awayScore")
        elif raw_status in PENDING:
            status = "pending"
            home_score = _count(item.get("homeScore"), prefix + ".homeScore") if item.get("homeScore") is not None else None
            away_score = _count(item.get("awayScore"), prefix + ".awayScore") if item.get("awayScore") is not None else None
        else:
            raise ValueError(f"{prefix}.status: situação do jogo desconhecida ({raw_status}).")
        if is_closed and status == "pending":
            raise ValueError(f"{prefix}: feche ou cancele todos os jogos antes do resultado oficial.")
        normalized["matches"].append({"home": home, "away": away, "homeScore": home_score, "awayScore": away_score, "status": status})
    for key in ("athletes", "season"):
        for index, item in enumerate(_items(data, key)):
            prefix = f"{key}[{index}]"
            name = _text(item.get("name"), prefix + ".name", limit=120)
            nickname = _text(item.get("nickname"), prefix + ".nickname", limit=120)
            if not name and not nickname:
                raise ValueError(f"{prefix}: informe name ou nickname.")
            athlete = {"name": name, "nickname": nickname,
                       "teamName": _text(item.get("teamName"), prefix + ".teamName", limit=120),
                       "position": _text(item.get("position"), prefix + ".position", limit=80),
                       "points": _points(item.get("points"), prefix + ".points")}
            for stat in ("goals", "assists", "interceptions", "tackles", "saves"):
                athlete[stat] = _count(item.get(stat), prefix + "." + stat)
            normalized[key].append(athlete)
    for index, item in enumerate(_items(data, "fantasy")):
        prefix = f"fantasy[{index}]"
        name = _text(item.get("name"), prefix + ".name", limit=120)
        owner = _text(item.get("owner"), prefix + ".owner", limit=120)
        if not name:
            raise ValueError(f"{prefix}.name: informe o nome do time fantasy.")
        names = item.get("athleteNames", [])
        if not isinstance(names, list) or len(names) > 30:
            raise ValueError(f"{prefix}.athleteNames: use uma lista com até 30 nomes.")
        names = [_text(value, prefix + ".athleteNames", limit=120) for value in names]
        normalized["fantasy"].append({"name": name, "owner": owner, "points": _points(item.get("points"), prefix + ".points"), "athleteNames": names})
    return normalized


def _athlete_name(athlete):
    return athlete["nickname"] or athlete["name"]


def _number(value):
    return f"{value:,.2f}".rstrip("0").rstrip(".").replace(",", "_").replace(".", ",").replace("_", ".")


def _ranks(items, score_key="points"):
    ordered = sorted(items, key=lambda item: (-item[score_key], (item.get("nickname") or item["name"]).casefold()))
    previous = None
    rank = 0
    for index, item in enumerate(ordered, 1):
        if previous != item[score_key]:
            rank = index
        previous = item[score_key]
        yield rank, item


def _font_names(pdfmetrics, TTFont):
    windows_fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    choices = [
        ("FPArial", windows_fonts / "arial.ttf", windows_fonts / "arialbd.ttf"),
        ("FPDejaVu", Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")),
    ]
    for family, regular, bold in choices:
        if regular.is_file() and bold.is_file():
            if family not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(family, str(regular)))
                pdfmetrics.registerFont(TTFont(f"{family}Bold", str(bold)))
                pdfmetrics.registerFontFamily(family, normal=family, bold=f"{family}Bold", italic=family, boldItalic=f"{family}Bold")
            return family, f"{family}Bold"
    return "Helvetica", "Helvetica-Bold"


def generate_report(payload, output_path):
    """Valida os dados e escreve o PDF de forma atômica. Retorna o caminho absoluto."""
    report = validate_payload(payload)
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether

    output = Path(output_path).expanduser().resolve()
    if output.suffix.lower() != ".pdf":
        raise ValueError("O arquivo de saída deve ter extensão .pdf.")
    output.parent.mkdir(parents=True, exist_ok=True)
    font, bold = _font_names(pdfmetrics, TTFont)
    green = colors.HexColor("#123E2B")
    green_light = colors.HexColor("#EAF3ED")
    gold = colors.HexColor("#C9A65B")
    gold_light = colors.HexColor("#FBF5E7")
    ink = colors.HexColor("#192D24")
    muted = colors.HexColor("#65756A")
    rule = colors.HexColor("#DDE7DF")
    width, height = A4
    margin = 17 * mm
    content_width = width - 2 * margin
    styles = {
        "title": ParagraphStyle("FPTitle", fontName=bold, fontSize=24, leading=28, textColor=green, spaceAfter=7),
        "subtitle": ParagraphStyle("FPSubtitle", fontName=font, fontSize=9, leading=13, textColor=muted, spaceAfter=4),
        "section": ParagraphStyle("FPSection", fontName=bold, fontSize=13, leading=17, textColor=green, spaceBefore=15, spaceAfter=8, keepWithNext=True),
        "label": ParagraphStyle("FPLabel", fontName=bold, fontSize=8, leading=11, textColor=green, alignment=TA_CENTER),
        "metric": ParagraphStyle("FPMetric", fontName=bold, fontSize=23, leading=28, textColor=green, alignment=TA_CENTER),
        "body": ParagraphStyle("FPBody", fontName=font, fontSize=8.5, leading=12, textColor=ink),
        "small": ParagraphStyle("FPSmall", fontName=font, fontSize=7.5, leading=10, textColor=muted),
        "header": ParagraphStyle("FPTableHead", fontName=bold, fontSize=7.5, leading=10, textColor=colors.white),
        "center": ParagraphStyle("FPCenter", fontName=font, fontSize=8.5, leading=12, textColor=ink, alignment=TA_CENTER),
        "notice": ParagraphStyle("FPNotice", fontName=font, fontSize=9, leading=13, textColor=green, spaceAfter=7),
    }

    def para(value, style="body"):
        return Paragraph(escape(str(value)).replace("\n", "<br/>"), styles[style])

    def section(label):
        story.append(para(label, "section"))

    def table(headers, rows, widths, numeric=()):
        if not rows:
            story.append(para("Nenhum registro", "small"))
            return
        values = [[para(value, "header") for value in headers]]
        values.extend([[para(value, "center" if column in numeric else "body") for column, value in enumerate(row)] for row in rows])
        result = Table(values, colWidths=widths, repeatRows=1, hAlign="LEFT")
        result.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), green),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, green_light]),
            ("LINEBELOW", (0, -1), (-1, -1), 0.6, rule),
        ]))
        story.append(result)

    story = []
    state = "RESULTADO OFICIAL" if report["isClosed"] else "PRÉVIA - RODADA ABERTA"
    story.append(para(state, "label"))
    story.append(Spacer(1, 5 * mm))
    story.append(para(report["title"], "title"))
    meta = [_display_date(report["date"])]
    if report["modality"]:
        meta.append(report["modality"])
    meta.append(f"Versão {report['revision']}")
    story.append(para("  |  ".join(meta), "subtitle"))
    if report["organizer"]:
        story.append(para("Organização: " + report["organizer"], "subtitle"))
    if report["isClosed"] and report["closedAt"]:
        story.append(para("Fechamento: " + _display_timestamp(report["closedAt"]), "subtitle"))
    if not report["isClosed"]:
        story.append(para("Dados provisórios. Pontos, resultados e posições podem mudar até o fechamento da pelada.", "notice"))
    finished_matches = [match for match in report["matches"] if match["status"] == "finished"]
    played_goals = sum(match["homeScore"] + match["awayScore"] for match in finished_matches)
    summary = Table([[
        [para(str(len(finished_matches)), "metric"), para("JOGOS FINALIZADOS", "label")],
        [para(str(played_goals), "metric"), para("GOLS NOS JOGOS", "label")],
        [para(str(len(report["athletes"])), "metric"), para("ATLETAS NA SÚMULA", "label")],
    ]], colWidths=[content_width / 3] * 3)
    summary.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), gold_light), ("BOX", (0, 0), (-1, -1), 0.8, gold), ("LINEBEFORE", (1, 0), (-1, 0), 0.5, gold), ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    story.append(Spacer(1, 4 * mm))
    story.append(summary)

    section("Resultados dos jogos do dia")
    match_rows = []
    for index, match in enumerate(report["matches"], 1):
        if match["status"] == "cancelled":
            score, status = "-", "Cancelado"
        elif match["status"] == "pending":
            score = f"{match['homeScore']} x {match['awayScore']}" if match["homeScore"] is not None and match["awayScore"] is not None else "-"
            status = "Em aberto"
        else:
            score, status = f"{match['homeScore']} x {match['awayScore']}", "Finalizado"
        match_rows.append([str(index), match["home"], score, match["away"], status])
    table(["Jogo", "Equipe", "Placar", "Equipe", "Situação"], match_rows,
          [content_width * value for value in (0.07, 0.30, 0.12, 0.30, 0.21)], numeric=(0, 2))

    for heading, stat, stat_label in (("Artilheiros do dia", "goals", "Gols"), ("Goleiros com mais defesas", "saves", "Defesas"), ("Líderes em assistências", "assists", "Assistências")):
        section(heading)
        maximum = max((item[stat] for item in report["athletes"]), default=0)
        leaders = sorted([item for item in report["athletes"] if item[stat] == maximum and maximum > 0], key=lambda item: _athlete_name(item).casefold())
        if leaders:
            story.append(para("Todos os líderes empatados estão relacionados." if len(leaders) > 1 else "Destaque pelo total acumulado nos jogos do dia.", "small"))
            story.append(Spacer(1, 2 * mm))
        table(["Atleta", "Equipe", stat_label], [[_athlete_name(item), item["teamName"] or "-", str(item[stat])] for item in leaders],
              [content_width * value for value in (0.50, 0.35, 0.15)], numeric=(2,))

    section("Ranking dos atletas - rodada")
    table(["Pos.", "Atleta / posição", "Gols", "Assist.", "Defesas", "Pontos"],
          [[str(rank), _athlete_name(item) + ("\n" + item["position"] if item["position"] else ""), str(item["goals"]), str(item["assists"]), str(item["saves"]), _number(item["points"])] for rank, item in _ranks(report["athletes"])],
          [content_width * value for value in (0.08, 0.43, 0.10, 0.10, 0.13, 0.16)], numeric=(0, 2, 3, 4, 5))
    section("Ranking fantasy - rodada")
    fantasy_rows = []
    for rank, item in _ranks(report["fantasy"]):
        description = item["name"]
        if item["owner"]:
            description += "\nTécnico: " + item["owner"]
        if item["athleteNames"]:
            description += "\nEscalação: " + ", ".join(item["athleteNames"])
        fantasy_rows.append([str(rank), description, _number(item["points"])])
    table(["Pos.", "Time fantasy", "Pontos"], fantasy_rows,
          [content_width * value for value in (0.08, 0.74, 0.18)], numeric=(0, 2))
    if report["season"]:
        section("Ranking dos atletas - temporada")
        table(["Pos.", "Atleta", "Gols", "Assist.", "Defesas", "Pontos"],
              [[str(rank), _athlete_name(item), str(item["goals"]), str(item["assists"]), str(item["saves"]), _number(item["points"])] for rank, item in _ranks(report["season"])],
              [content_width * value for value in (0.08, 0.43, 0.10, 0.10, 0.13, 0.16)], numeric=(0, 2, 3, 4, 5))
    story.append(Spacer(1, 6 * mm))
    story.append(para("Os rankings usam os pontos recebidos na súmula. Empates compartilham a mesma posição. Este relatório apresenta somente os dados registrados no Fut Parça.", "small"))

    def decorate(canvas, document):
        canvas.saveState()
        canvas.setFillColor(green)
        canvas.rect(0, height - 17 * mm, width, 17 * mm, fill=1, stroke=0)
        canvas.setFillColor(gold)
        canvas.rect(0, height - 17.8 * mm, width, 0.8 * mm, fill=1, stroke=0)
        canvas.setFont(bold, 12)
        canvas.setFillColor(colors.white)
        canvas.drawString(margin, height - 11 * mm, "FUT PARÇA")
        canvas.setFont(font, 7.5)
        canvas.drawRightString(width - margin, height - 10.6 * mm, "SUA TURMA. SUA PELADA.")
        canvas.setStrokeColor(rule)
        canvas.line(margin, 14 * mm, width - margin, 14 * mm)
        canvas.setFont(font, 7)
        canvas.setFillColor(muted)
        canvas.drawString(margin, 9.5 * mm, "Fut Parça  |  " + ("Resultado oficial" if report["isClosed"] else "Prévia") + f"  |  v{report['revision']}")
        canvas.drawRightString(width - margin, 9.5 * mm, f"Página {document.page}")
        canvas.restoreState()

    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".fut-parca-", suffix=".pdf", dir=str(output.parent), delete=False) as handle:
            temporary = Path(handle.name)
        document = SimpleDocTemplate(str(temporary), pagesize=A4, leftMargin=margin, rightMargin=margin,
                                     topMargin=25 * mm, bottomMargin=22 * mm,
                                     title=f"Fut Parça - {report['title']}", author="Fut Parça", subject=state,
                                     pageCompression=1)
        document.build(story, onFirstPage=decorate, onLaterPages=decorate)
        temporary.replace(output)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return output


def main(argv=None):
    # O servidor Node decodifica os pipes como UTF-8 também no Windows.
    # Fixar a codificação evita substituir acentos das mensagens de validação.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description="Gera o PDF da pelada a partir de um JSON validado, sem inserir dados fictícios.")
    parser.add_argument("--input", required=True, type=Path, help="Caminho do JSON UTF-8 do relatório")
    parser.add_argument("--output", required=True, type=Path, help="Caminho de saída do PDF")
    args = parser.parse_args(argv)
    try:
        if args.input.stat().st_size > MAX_INPUT_BYTES:
            raise ValueError("O JSON excede o limite de 5 MB.")
        with args.input.open("r", encoding="utf-8-sig") as source:
            payload = json.load(source)
        output = generate_report(payload, args.output)
    except (OSError, ValueError, ImportError) as error:
        print(f"Não foi possível gerar o relatório: {error}", file=sys.stderr)
        return 1
    print(str(output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
