import PDFDocument from 'pdfkit';

const safe = value => String(value ?? '');
const number = value => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export function generatePdfReport(payload) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 42, info: { Title: `Fut Parça — ${safe(payload.title)}` } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const heading = title => {
      if (doc.y > 720) doc.addPage();
      doc.moveDown(0.6).font('Helvetica-Bold').fontSize(15).fillColor('#183e2a').text(title);
      doc.moveDown(0.25).strokeColor('#b7ef4a').lineWidth(2).moveTo(42, doc.y).lineTo(553, doc.y).stroke();
      doc.moveDown(0.45).fillColor('#172019').font('Helvetica').fontSize(10);
    };
    const row = (left, right = '') => {
      if (doc.y > 760) doc.addPage();
      const y = doc.y;
      doc.font('Helvetica').fontSize(9.5).fillColor('#172019').text(safe(left), 46, y, { width: 390 });
      doc.font('Helvetica-Bold').text(safe(right), 440, y, { width: 108, align: 'right' });
      doc.moveDown(0.5).strokeColor('#e2e7e3').lineWidth(0.5).moveTo(46, doc.y).lineTo(548, doc.y).stroke();
      doc.moveDown(0.35);
    };

    doc.rect(0, 0, 595.28, 118).fill('#0d281a');
    doc.font('Helvetica-Bold').fontSize(27).fillColor('#c8ff55').text('FUT PARÇA', 42, 34);
    doc.fontSize(18).fillColor('#ffffff').text(safe(payload.title || 'Resultado da pelada'), 42, 70);
    doc.font('Helvetica').fontSize(9).fillColor('#cbd8cf').text(`${safe(payload.date)} · ${safe(payload.modality)} · Relatório v${number(payload.revision || 1)}`, 42, 96);
    doc.y = 136;

    heading('Resultados dos jogos');
    for (const match of payload.matches || []) row(`${safe(match.home)}  ${number(match.homeScore)} × ${number(match.awayScore)}  ${safe(match.away)}`, safe(match.status));

    const athletes = [...(payload.athletes || [])];
    const leaders = (key, label) => {
      const max = Math.max(0, ...athletes.map(item => Number(item[key] || 0)));
      const names = max ? athletes.filter(item => Number(item[key] || 0) === max).map(item => item.nickname || item.name).join(' / ') : 'Sem registros';
      row(label, `${names} · ${number(max)}`);
    };
    heading('Destaques do dia');
    leaders('goals', 'Artilharia');
    leaders('assists', 'Mais assistências');
    leaders('saves', 'Mais defesas');

    heading('Desempenho individual');
    athletes.sort((a, b) => Number(b.points || 0) - Number(a.points || 0));
    for (const item of athletes) row(`${safe(item.nickname || item.name)} — ${number(item.goals)} G · ${number(item.assists)} A · ${number(item.saves)} DEF`, `${number(item.points)} pts`);

    if ((payload.fantasy || []).length) {
      heading('Liga dos Parças');
      for (const item of payload.fantasy) row(safe(item.name || item.ownerName || 'Time'), `${number(item.points)} pts`);
    }

    doc.moveDown().font('Helvetica').fontSize(8).fillColor('#68736b').text(`Gerado pelo Fut Parça · ${safe(payload.organizer)}`, { align: 'center' });
    doc.end();
  });
}
