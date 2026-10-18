/* Ecoesencias · Servicio Técnico — genera la hoja de servicio en PDF dentro del
   mismo teléfono (funciona sin señal). Usa pdf-lib (vendor/pdf-lib.min.js). */
(function () {
  const {PDFDocument, StandardFonts, rgb} = PDFLib;
  const GREEN = rgb(0x1A / 255, 0x3D / 255, 0x2B / 255);
  const INK = rgb(0.11, 0.145, 0.125), MUTED = rgb(0.37, 0.42, 0.38), LINE = rgb(0.8, 0.84, 0.78);
  const LIGHT = rgb(0.93, 0.95, 0.92), RED = rgb(0.65, 0.23, 0.16), WHITE = rgb(1, 1, 1);
  const W = 595.28, H = 841.89, M = 34, CW = W - 2 * M, BOTTOM = 50;
  const WIN = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
  const clean = s => Array.from(String(s ?? '').replace(/\r/g, '').replace(/\t/g, ' ')).map(c => {
    const n = c.charCodeAt(0);
    return (n === 10 || (n >= 32 && n <= 126) || (n >= 160 && n <= 255) || WIN.has(c)) ? c : '?';
  }).join('');
  const bytes = d => { const b = atob(String(d).split(',').pop()); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };

  const TIPOS = ['Instalación', 'Mantención preventiva', 'Mantención correctiva', 'Retiro de equipo', 'Revisión técnica', 'Cambio de ubicación'];
  const TRABAJOS = ['Equipo instalado', 'Equipo retirado', 'Equipo revisado', 'Limpieza realizada', 'Recarga o cambio de aroma', 'Programación ajustada', 'Pilas reemplazadas', 'Fuente de poder revisada', 'Funcionamiento comprobado', 'Equipo entregado operativo', 'Evidencia fotográfica registrada', 'Requiere nueva visita', 'Copia entregada o enviada al cliente'];
  const RES = {conforme: 'Conforme y operativo', obs: 'Operativo con observaciones', pendiente: 'Pendiente de solución', fuera: 'Equipo fuera de servicio'};
  const FOTOS = [['antes', 'Por dentro (cómo estaba)'], ['despues', 'Cómo quedó'], ['general', 'Vista general']];
  const dmy = s => s ? String(s).split('-').reverse().join('/') : '—';

  async function build(s, ctx) {
    const doc = await PDFDocument.create();
    doc.setTitle('Hoja de servicio ' + ctx.osTxt); doc.setAuthor('Ecoesencias'); doc.setCreator('Ecoesencias Servicio Técnico');
    const F = await doc.embedFont(StandardFonts.Helvetica);
    const FB = await doc.embedFont(StandardFonts.HelveticaBold);
    const FI = await doc.embedFont(StandardFonts.HelveticaOblique);
    const logo = await doc.embedPng(bytes(ctx.logo));
    const imgCache = {};
    const img = async d => {
      if (!d) return null;
      if (imgCache[d]) return imgCache[d];
      try { return imgCache[d] = /^data:image\/png/.test(d) ? await doc.embedPng(bytes(d)) : await doc.embedJpg(bytes(d)); }
      catch (e) { return null; }
    };
    let page, y;

    const T = (str, x, yy, o = {}) => page.drawText(clean(str), {x, y: yy, size: o.size || 9, font: o.f || F, color: o.color || INK});
    const wrap = (str, f, size, width) => {
      const out = [];
      clean(str).split('\n').forEach(par => {
        let line = '';
        par.split(/\s+/).filter(Boolean).forEach(w => {
          while (f.widthOfTextAtSize(w, size) > width) { // palabra muy larga
            let i = w.length; while (i > 1 && f.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
            if (line) { out.push(line); line = ''; }
            out.push(w.slice(0, i)); w = w.slice(i);
          }
          const t = line ? line + ' ' + w : w;
          if (f.widthOfTextAtSize(t, size) > width) { out.push(line); line = w; } else line = t;
        });
        out.push(line);
      });
      return out.length ? out : [''];
    };
    const newPage = cont => {
      page = doc.addPage([W, H]); y = H - M;
      if (cont) {
        const h = 20, w = h * logo.width / logo.height;
        page.drawImage(logo, {x: M, y: y - h, width: w, height: h});
        T('Hoja de servicio ' + ctx.osTxt + ' (continuación)', M + w + 10, y - 13, {f: FB, size: 9, color: GREEN});
        y -= h + 8;
        page.drawLine({start: {x: M, y}, end: {x: W - M, y}, thickness: 1, color: GREEN});
        y -= 12;
      }
    };
    const ensure = h => { if (y - h < BOTTOM) newPage(true); };
    const section = title => {
      ensure(42);
      page.drawRectangle({x: M, y: y - 16, width: CW, height: 16, color: GREEN});
      T(title.toUpperCase(), M + 7, y - 11.5, {f: FB, size: 8.5, color: WHITE});
      y -= 22;
    };
    const kv = (items, cols = 3) => {
      const gap = 12, cw = (CW - gap * (cols - 1)) / cols;
      for (let i = 0; i < items.length; i += cols) {
        const row = items.slice(i, i + cols).map(([k, v]) => [k, wrap(v === '' || v == null ? '—' : v, F, 9, cw)]);
        const h = 10 + Math.max(...row.map(r => r[1].length)) * 11;
        ensure(h);
        row.forEach(([k, lines], j) => {
          const x = M + j * (cw + gap);
          T(k.toUpperCase(), x, y - 7, {f: FB, size: 6.8, color: MUTED});
          lines.forEach((l, n) => T(l, x, y - 18 - n * 11, {size: 9}));
        });
        y -= h + 3;
      }
    };
    const box = (x, yy, on) => {
      page.drawRectangle({x, y: yy, width: 8, height: 8, borderColor: on ? INK : LINE, borderWidth: 0.9});
      if (on) {
        page.drawLine({start: {x: x + 1.6, y: yy + 4.2}, end: {x: x + 3.4, y: yy + 2}, thickness: 1.4, color: GREEN});
        page.drawLine({start: {x: x + 3.4, y: yy + 2}, end: {x: x + 6.8, y: yy + 6.6}, thickness: 1.4, color: GREEN});
      }
    };
    const checks = (items, cols = 3) => {
      const cw = CW / cols;
      for (let i = 0; i < items.length; i += cols) {
        const row = items.slice(i, i + cols).map(it => Object.assign({}, it, {lines: wrap(it.t, F, 8.5, cw - 16)}));
        const h = Math.max(...row.map(r => r.lines.length)) * 10 + 4;
        ensure(h);
        row.forEach((it, j) => {
          const x = M + j * cw;
          box(x, y - 9, it.on);
          it.lines.forEach((l, n) => T(l, x + 13, y - 8 - n * 10, {size: 8.5, color: it.on ? INK : MUTED}));
        });
        y -= h + 2;
      }
    };
    const table = (heads, rows, widths) => {
      const pad = 4, draw = (cells, f, size, fill) => {
        const lines = cells.map((c, i) => wrap(c, f, size, widths[i] - pad * 2));
        const h = Math.max(...lines.map(l => l.length)) * (size + 2) + pad * 2;
        ensure(h);
        let x = M;
        cells.forEach((c, i) => {
          page.drawRectangle({x, y: y - h, width: widths[i], height: h, borderColor: LINE, borderWidth: 0.7, color: fill});
          lines[i].forEach((l, n) => T(l, x + pad, y - pad - size + 1 - n * (size + 2), {f, size}));
          x += widths[i];
        });
        y -= h;
      };
      draw(heads, FB, 7.8, LIGHT);
      rows.forEach(r => draw(r, F, 8.5, undefined));
      y -= 8;
    };
    const textBox = (str, f = F, size = 9) => {
      let lines = wrap(str || '—', f, size, CW - 16);
      const lh = size + 2.6;
      while (lines.length) {
        const fit = Math.max(1, Math.floor((y - BOTTOM - 14) / lh));
        if (fit < 2 && lines.length > 1) { newPage(true); continue; }
        const chunk = lines.slice(0, fit); lines = lines.slice(fit);
        const h = chunk.length * lh + 12;
        page.drawRectangle({x: M, y: y - h, width: CW, height: h, borderColor: LINE, borderWidth: 0.8});
        chunk.forEach((l, n) => T(l, M + 8, y - 6 - size - n * lh + 2, {f, size}));
        y -= h + 8;
        if (lines.length) newPage(true);
      }
    };
    const para = (str, f, size, color) => {
      wrap(str, f, size, CW).forEach(l => { ensure(size + 3); T(l, M, y - size, {f, size, color}); y -= size + 2.6; });
      y -= 5;
    };
    const fit = (im, x, yy, w, h) => {
      const k = Math.min(w / im.width, h / im.height);
      const iw = im.width * k, ih = im.height * k;
      page.drawImage(im, {x: x + (w - iw) / 2, y: yy + (h - ih) / 2, width: iw, height: ih});
    };

    /* ---------- Encabezado ---------- */
    newPage(false);
    const lh = 52, lw = lh * logo.width / logo.height;
    page.drawImage(logo, {x: M, y: y - lh, width: lw, height: lh});
    const bx = W - M - 150;
    T('HOJA DE SERVICIO TÉCNICO', M + lw + 14, y - 20, {f: FB, size: 14, color: GREEN});
    T('Instalación, mantención y retiro de equipos', M + lw + 14, y - 34, {f: FI, size: 9, color: MUTED});
    page.drawRectangle({x: bx, y: y - lh, width: 150, height: lh, borderColor: GREEN, borderWidth: 1});
    T('N° Orden de Servicio', bx + 8, y - 11, {size: 7.5, color: MUTED});
    T(ctx.osTxt, bx + 8, y - 24, {f: FB, size: 12.5});
    T('Fecha del servicio', bx + 8, y - 36, {size: 7.5, color: MUTED});
    T(dmy(s.fecha), bx + 8, y - 48, {f: FB, size: 10.5});
    y -= lh + 8;
    page.drawLine({start: {x: M, y}, end: {x: W - M, y}, thickness: 1.6, color: GREEN});
    y -= 12;

    const su = ctx.sucursal, cl = ctx.cliente;
    section('Datos del cliente');
    kv([['Cliente o razón social', cl.nombre], ['RUT', cl.rut], ['N° sucursal / local', [su.numero, su.nombre].filter(Boolean).join(' · ')],
      ['Dirección del servicio', su.direccion], ['Comuna / Ciudad', su.comuna], ['Nombre del encargado', su.encargado],
      ['Teléfono', su.telefono], ['Correo electrónico', s.correo], ['Horario de atención', su.horario],
      ['Hora de llegada', s.llegada], ['Hora de término', s.termino], ['Técnico', ctx.tecnico]]);

    section('Tipo de asistencia');
    checks(TIPOS.map(t => ({t, on: s.tipos.includes(t)})).concat([{t: 'Otro' + (s.tipos.includes('Otro') && s.otro ? ': ' + s.otro : ''), on: s.tipos.includes('Otro')}]));
    ensure(14); T('Equipo de reemplazo instalado: ', M, y - 9, {size: 8.5}); T(s.reemplazo === 'si' ? 'Sí' : 'No', M + F.widthOfTextAtSize('Equipo de reemplazo instalado: ', 8.5), y - 9, {f: FB, size: 8.5}); y -= 18;

    section('Equipos');
    const eqs = s.equipos.filter(q => q.atendido);
    table(['N°', 'Modelo', 'Color', 'N° de serie', 'Aroma / lote', 'Ubicación'],
      eqs.map((q, i) => [String(i + 1), q.modelo, q.color, q.serie, q.aroma, q.ubicacion]), [24, 120, 52, 95, 110, CW - 401]);

    section('Revisión y trabajo realizado');
    checks(TRABAJOS.map(t => ({t, on: s.trabajo.includes(t)})));
    ensure(16); T('Resultado del servicio: ', M, y - 10, {f: FB, size: 9}); T(RES[s.resultado] || s.resultado, M + FB.widthOfTextAtSize('Resultado del servicio: ', 9), y - 10, {size: 9}); y -= 20;

    section('Resumen del trabajo, anomalías y observaciones');
    textBox(s.obs);

    section('Control de mantenciones');
    kv([['Próxima mantención', dmy(s.proxima)], ['¿Seguimiento?', s.seguimiento === 'si' ? 'Sí' : 'No'], ['Motivo / acción pendiente', s.seguimiento === 'si' ? s.motivo : '—']]);

    y -= 2;

    /* ---------- Firmas ---------- */
    para('Mediante su firma, el cliente confirma la realización del servicio indicado y la recepción de la información y recomendaciones correspondientes. La firma acredita la visita y el trabajo descrito, sin impedir que el cliente registre observaciones en esta misma hoja. Si el cliente no se encuentra disponible para firmar, el técnico marca la opción correspondiente y la visita se respalda con evidencia fotográfica, que se adjunta en el anexo.', FI, 7.2, MUTED);
    const sh = 108, sw = (CW - 12) / 2;
    ensure(sh + 6);
    const sigBox = async (x, title, firma, ausente, lines) => {
      page.drawRectangle({x, y: y - sh, width: sw, height: sh, borderColor: LINE, borderWidth: 0.8});
      T(title, x + 8, y - 13, {f: FB, size: 8.5, color: GREEN});
      const areaY = y - 17 - 40;
      if (ausente) T('Cliente ausente / firma no disponible', x + 8, areaY + 22, {f: FB, size: 9, color: RED});
      else { const im = await img(firma); if (im) fit(im, x + 8, areaY, sw - 16, 40); }
      page.drawLine({start: {x: x + 8, y: areaY - 3}, end: {x: x + sw - 8, y: areaY - 3}, thickness: 0.6, color: LINE});
      lines.forEach(([k, v], n) => {
        T(k + ':', x + 8, areaY - 13 - n * 10.5, {f: FB, size: 8});
        T(v || '—', x + 8 + FB.widthOfTextAtSize(k + ': ', 8), areaY - 13 - n * 10.5, {size: 8});
      });
    };
    await sigBox(M, 'CLIENTE', s.firma, s.ausente, s.ausente ? [['Fecha', dmy(s.fecha)]] :
      [['Nombre', s.cliente.nombre], ['RUT', s.cliente.rut], ['Cargo', s.cliente.cargo], ['Fecha', dmy(s.fecha)]]);
    await sigBox(M + sw + 12, 'TÉCNICO RESPONSABLE', ctx.firmaTecnico, false, [['Nombre', ctx.tecnico], ['Fecha', dmy(s.fecha)]]);
    y -= sh + 8;

    /* ---------- Anexo fotográfico ---------- */
    if (eqs.some(q => q.fotos && Object.values(q.fotos).some(Boolean))) {
      newPage(true);
      section('Anexo · Evidencia fotográfica');
      const gap = 8, cw = (CW - gap * 2) / 3, ch = cw * 0.92;
      for (let i = 0; i < eqs.length; i++) {
        const q = eqs[i];
        ensure(14 + ch + 18);
        T('Equipo ' + (i + 1) + ' · ' + [q.modelo, q.ubicacion, q.serie && ('Serie ' + q.serie)].filter(Boolean).join(' · '), M, y - 9, {f: FB, size: 9});
        y -= 14;
        for (let j = 0; j < FOTOS.length; j++) {
          const x = M + j * (cw + gap);
          page.drawRectangle({x, y: y - ch, width: cw, height: ch, color: LIGHT});
          const im = await img(q.fotos && q.fotos[FOTOS[j][0]]);
          if (im) fit(im, x, y - ch, cw, ch);
          T(FOTOS[j][1], x, y - ch - 10, {size: 7.5, color: MUTED});
        }
        y -= ch + 22;
      }
    }

    /* ---------- Pie de página ---------- */
    const pages = doc.getPages();
    pages.forEach((p, i) => {
      page = p;
      p.drawLine({start: {x: M, y: 42}, end: {x: W - M, y: 42}, thickness: 0.6, color: LINE});
      const foot = clean('Ecoesencias – Marketing Olfativo | Aromatizamos tus espacios');
      p.drawText(foot, {x: (W - FB.widthOfTextAtSize(foot, 8)) / 2, y: 28, size: 8, font: FB, color: GREEN});
      T(ctx.osTxt, M, 28, {size: 7.5, color: MUTED});
      const pg = 'Página ' + (i + 1) + ' de ' + pages.length;
      T(pg, W - M - F.widthOfTextAtSize(pg, 7.5), 28, {size: 7.5, color: MUTED});
    });
    return await doc.save();
  }

  window.EcoPDF = {build};
})();
