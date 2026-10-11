// Імпорт даних із Wix: CSV колекцій → таблиця Google (дія importData) + перенесення фото груп на Google Диск.
// Файли читаються лише в браузері; на сервер іде тільки те, що ви підтвердили. Лише для адміністратора.
import { mountLayout } from '../layout.js';
import { t, tv, getLang } from '../i18n.js';
import { h, icon, fmtDateLong, $ } from '../util.js';
import { api, errorText, isAdminLoggedIn, ApiError } from '../api.js';
import { CONFIG } from '../config.js';
import { toast } from '../modal.js';
import * as W from '../wix-import.js';

mountLayout({ active: null });
document.title = t('imp.title') + ' — AZART';

const app = $('#app');
const root = h('div', { class: 'container imp-wrap' });
app.append(root);

const state = {
  files: {},          // вид → { name, rows }
  choice: {},         // ключ бланка → { include, kindergarten, discountEnabled }
  importPrices: true,
  migrate: true,
  running: false,
  stop: false
};
let P = null;         // розібрані дані

const albumKey = (a) => a.id || `line-${a.line}`;
const emptyList = { list: [], warnings: [] };

function reparse() {
  const f = state.files;
  P = {
    albums: f.albums ? W.parseAlbums(f.albums.rows) : emptyList,
    orders: f.orders ? W.parseOrders(f.orders.rows) : emptyList,
    items: f.items ? W.parseItems(f.items.rows) : emptyList,
    prices: f.prices ? W.parsePrices(f.prices.rows) : null,
    groupPhotos: f.groupPhotos ? W.parseGroupPhotos(f.groupPhotos.rows) : emptyList
  };
  const only = CONFIG.KINDERGARTENS.length === 1 ? CONFIG.KINDERGARTENS[0] : '';
  P.albums.list.forEach((a) => {
    const k = albumKey(a);
    if (!state.choice[k]) {
      state.choice[k] = { include: !a.problems.length, kindergarten: a.kindergarten || only, discountEnabled: a.discountEnabled };
    }
  });
}

const parsedForBatches = () => ({
  albums: P.albums.list, orders: P.orders.list, items: P.items.list,
  groupPhotos: P.groupPhotos.list, prices: P.prices ? P.prices.values : null
});

function choicesForBatches() {
  const albums = {};
  P.albums.list.forEach((a) => { if (a.id) albums[a.id] = state.choice[albumKey(a)]; });
  return { albums, importPrices: state.importPrices && !!P.prices };
}

// ------------------------------------------------------------------ шапка сторінки
const back = h('a', { class: 'back-link', href: 'admin.html' }, icon('arrowLeft', 18), h('span', null, t('imp.back')));
const head = h('header', { class: 'page-head imp-head' },
  h('h1', { class: 'page-title' }, t('imp.title')),
  h('p', { class: 'page-sub small' }, t('imp.sub')));

if (!isAdminLoggedIn()) {
  root.append(back, head, h('div', { class: 'note note-warn imp-need' }, icon('lock', 18),
    h('div', null, h('p', null, t('imp.needAdmin')),
      h('a', { class: 'btn btn-primary btn-sm', href: 'admin.html', style: { marginTop: '10px' } }, t('imp.goLogin')))));
} else {
  boot();
}

// ------------------------------------------------------------------ побудова сторінки
function boot() {
  const filesCard = h('section', { class: 'card imp-card' });
  const albumsCard = h('section', { class: 'card imp-card', hidden: true });
  const restCard = h('section', { class: 'card imp-card', hidden: true });
  const actionBar = h('div', { class: 'imp-action' });
  const progressCard = h('section', { class: 'card imp-card', hidden: true, 'aria-live': 'polite' });
  const resultCard = h('section', { class: 'card imp-card', hidden: true });
  const setup = h('div', { class: 'imp-setup' }, filesCard, albumsCard, restCard, actionBar);
  root.append(back, head, setup, progressCard, resultCard);

  // ---------------------------------------------------------- 1. файли
  const input = h('input', { class: 'imp-file', type: 'file', multiple: true, accept: '.csv,text/csv', 'aria-label': t('imp.drop') });
  const dropText = h('span', null, t('imp.drop'));
  const drop = h('label', { class: 'imp-drop' }, icon('upload', 28), dropText, input);
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); dropText.textContent = t('imp.dropActive'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); dropText.textContent = t('imp.drop'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });

  const slots = h('ul', { class: 'imp-slots' });
  filesCard.append(
    h('h2', { class: 'imp-h' }, t('imp.step1')),
    h('p', { class: 'imp-hint' }, t('imp.step1Hint')),
    drop, slots);

  function paintSlots() {
    slots.replaceChildren(...W.KINDS.map((kind) => {
      const f = state.files[kind];
      const rm = h('button', { class: 'imp-x', type: 'button', title: t('imp.remove'), 'aria-label': t('imp.remove') }, icon('close', 16));
      rm.addEventListener('click', () => { delete state.files[kind]; changed(); });
      return h('li', { class: 'imp-slot' + (f ? ' is-ok' : ''), 'data-kind': kind },
        h('span', { class: 'imp-slot-ico', 'aria-hidden': 'true' }, f ? icon('checkBold', 14) : null),
        h('span', { class: 'imp-slot-name' }, t('imp.kind.' + kind)),
        h('span', { class: 'imp-slot-file' }, f ? `${f.name} · ${t('imp.rows', { n: f.rows.length })}` : t('imp.slotEmpty')),
        f ? rm : null);
    }));
  }

  async function addFiles(list) {
    for (const file of Array.from(list || [])) {
      try {
        const { kind, rows } = W.readCsv(await file.text());
        if (!kind) { toast(t('imp.unknownFile', { name: file.name }), 'error', 6000); continue; }
        state.files[kind] = { name: file.name, rows };
      } catch (e) {
        toast(t('imp.readError', { name: file.name }), 'error', 6000);
      }
    }
    changed();
  }

  // ---------------------------------------------------------- 2. бланки
  const albumList = h('div', { class: 'imp-albums' });
  const bulkSelect = h('select', { class: 'select imp-bulk-select', 'aria-label': t('imp.bulkLabel') },
    h('option', { value: '' }, t('imp.chooseKg')),
    CONFIG.KINDERGARTENS.map((k) => h('option', { value: k }, k)));
  const bulkBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('imp.bulkApply'));
  bulkBtn.addEventListener('click', () => {
    if (!bulkSelect.value) return;
    P.albums.list.forEach((a) => { state.choice[albumKey(a)].kindergarten = bulkSelect.value; });
    paintAlbums();
    paintAction();
  });
  albumsCard.append(
    h('h2', { class: 'imp-h' }, t('imp.step2')),
    h('p', { class: 'imp-hint' }, t('imp.step2Hint')),
    h('div', { class: 'imp-bulk' }, h('span', { class: 'imp-bulk-label' }, t('imp.bulkLabel')), bulkSelect, bulkBtn),
    albumList);

  function albumRow(a) {
    const c = state.choice[albumKey(a)];
    const orderCount = P.orders.list.filter((o) => o.albumId === a.id).length;
    const includeBox = h('input', { type: 'checkbox', checked: c.include && !a.problems.length, disabled: !!a.problems.length, 'aria-label': t('imp.colInclude') });
    includeBox.addEventListener('change', () => { c.include = includeBox.checked; row.classList.toggle('is-off', !c.include); paintRest(); paintAction(); });

    const kg = h('select', { class: 'select imp-kg', 'aria-label': t('imp.kgLabel') },
      h('option', { value: '' }, t('imp.chooseKg')),
      [...new Set([...CONFIG.KINDERGARTENS, ...(c.kindergarten ? [c.kindergarten] : [])])].map((k) => h('option', { value: k, selected: k === c.kindergarten }, k)));
    kg.addEventListener('change', () => { c.kindergarten = kg.value; kg.classList.remove('is-invalid'); paintAction(); });

    const gift = h('input', { type: 'checkbox', checked: !!c.discountEnabled });
    gift.addEventListener('change', () => { c.discountEnabled = gift.checked; });

    const meta = [
      a.types.map(tv).join(' · '),
      a.deadline ? t('imp.deadlineTo', { date: fmtDateLong(a.deadline, getLang()) }) : t('imp.noDeadline'),
      a.id ? t('imp.albumOrders', { n: orderCount }) : ''
    ].filter(Boolean).join('  ·  ');

    const flags = [
      ...a.problems.map((p) => h('span', { class: 'imp-flag imp-flag-bad' }, t('imp.problem.' + p))),
      ...a.notes.map((n) => h('span', { class: 'imp-flag imp-flag-warn' }, t('imp.note.' + n)))
    ];

    const row = h('article', { class: 'imp-album' + (c.include && !a.problems.length ? '' : ' is-off'), 'data-title': a.title },
      h('label', { class: 'check imp-inc' }, includeBox),
      h('div', { class: 'imp-album-main' },
        h('h3', { class: 'imp-album-title' }, a.title || '—'),
        h('p', { class: 'imp-album-meta' }, meta),
        flags.length ? h('div', { class: 'imp-flags' }, flags) : null),
      h('div', { class: 'imp-album-side' },
        h('label', { class: 'imp-field' }, h('span', { class: 'imp-field-label' }, t('imp.kgLabel')), kg),
        h('label', { class: 'check imp-gift' }, gift, h('span', null, t('imp.giftLabel'))),
        !a.discountKnown ? h('p', { class: 'imp-hint imp-gift-hint' }, t('imp.giftUnknown')) : null));
    return row;
  }

  function paintAlbums() {
    albumsCard.hidden = !state.files.albums;
    albumList.replaceChildren(...P.albums.list.map(albumRow));
  }

  // ---------------------------------------------------------- 3. решта + перевірка
  const sums = h('div', { class: 'imp-sums' });
  const options = h('div', { class: 'imp-options' });
  const checks = h('ul', { class: 'imp-checks' });
  restCard.append(h('h2', { class: 'imp-h' }, t('imp.step3')), sums, options,
    h('h3', { class: 'imp-h2' }, t('imp.checkTitle')), checks);

  const tile = (key, label, value, sub) => h('div', { class: 'imp-sum', 'data-sum': key },
    h('span', { class: 'imp-sum-label' }, label), h('b', { class: 'imp-sum-val' }, String(value)), sub ? h('span', { class: 'imp-sum-sub' }, sub) : null);

  function includedPlan() {
    return W.buildBatches(parsedForBatches(), choicesForBatches());
  }

  function paintRest() {
    const f = state.files;
    const any = f.orders || f.items || f.prices || f.groupPhotos;
    restCard.hidden = !any;
    if (!any) return;
    const plan = includedPlan();
    sums.replaceChildren(
      f.orders ? tile('orders', t('imp.sumOrders'), plan.totals.orders, f.albums ? `/ ${P.orders.list.length}` : '') : null,
      f.items ? tile('items', t('imp.sumItems'), plan.totals.items, f.albums ? `/ ${P.items.list.length}` : '') : null,
      f.prices ? tile('prices', t('imp.sumPrices'), P.prices.found, t('imp.pricesFound', { n: P.prices.found, total: W.PRICE_KEYS.length })) : null,
      f.groupPhotos ? tile('photos', t('imp.sumPhotos'), P.groupPhotos.list.length) : null);

    const priceBox = h('input', { type: 'checkbox', checked: state.importPrices });
    priceBox.addEventListener('change', () => { state.importPrices = priceBox.checked; });
    const migBox = h('input', { type: 'checkbox', checked: state.migrate });
    migBox.addEventListener('change', () => { state.migrate = migBox.checked; });
    options.replaceChildren(
      f.prices ? h('label', { class: 'check imp-opt' }, priceBox, h('span', null, t('imp.importPrices'))) : null,
      f.groupPhotos ? h('label', { class: 'check imp-opt' }, migBox, h('span', null, t('imp.migrate'))) : null);

    // перевірка зв'язків між файлами й попередження розбору
    const cons = W.checkConsistency({ albums: P.albums.list, orders: P.orders.list, items: P.items.list });
    const lines = [];
    const push = (kind, text) => lines.push(h('li', { class: 'imp-check imp-check-' + kind }, icon(kind === 'ok' ? 'checkBold' : 'info', 15), h('span', null, text)));
    if (f.albums && f.orders && cons.orphanOrders) push('warn', t('imp.chk.orphanOrders', { n: cons.orphanOrders }));
    if (f.orders && f.items && cons.orphanItems) push('warn', t('imp.chk.orphanItems', { n: cons.orphanItems }));
    if (f.orders && f.items && cons.noItems) push('info', t('imp.chk.noItems', { n: cons.noItems }));
    if (f.orders && f.items && cons.mismatch) push('info', t('imp.chk.mismatch', { n: cons.mismatch }));
    if (f.albums && (plan.skipped.orders - cons.orphanOrders > 0 || plan.skipped.items - cons.orphanItems > 0)) {
      push('warn', t('imp.chk.skipped', { orders: Math.max(0, plan.skipped.orders - cons.orphanOrders), items: Math.max(0, plan.skipped.items - cons.orphanItems) }));
    }
    [P.albums, P.orders, P.items, P.prices || emptyList, P.groupPhotos].forEach((p) => {
      (p.warnings || []).forEach((w) => push('warn', t('imp.warn.' + w.key, w.vars)));
    });
    if (!lines.length) push('ok', t('imp.chk.ok'));
    checks.replaceChildren(...lines);
  }

  // ---------------------------------------------------------- дія
  const startBtn = h('button', { class: 'btn btn-primary btn-lg imp-start', type: 'button' }, icon('upload', 20), h('span', null, t('imp.start')));
  const why = h('p', { class: 'imp-why', role: 'status' });
  actionBar.append(startBtn, why);
  startBtn.addEventListener('click', () => { if (!startBtn.disabled) runImport(); });

  function blocker() {
    if (!Object.keys(state.files).length) return t('imp.why.noFiles');
    const chosen = P.albums.list.filter((a) => !a.problems.length && state.choice[albumKey(a)].include);
    if (chosen.some((a) => !state.choice[albumKey(a)].kindergarten)) return t('imp.why.kg');
    const plan = includedPlan();
    const t0 = plan.totals;
    if (!t0.albums && !t0.orders && !t0.items && !t0.groupPhotos && !t0.prices) return t('imp.why.nothing');
    return '';
  }

  function paintAction() {
    const reason = state.running ? '' : blocker();
    startBtn.disabled = state.running || !!reason;
    why.textContent = reason;
    actionBar.hidden = false;
  }

  function changed() {
    reparse();
    paintSlots();
    paintAlbums();
    paintRest();
    paintAction();
  }

  // ---------------------------------------------------------- хід імпорту
  function stepEl(label) {
    const ico = h('span', { class: 'imp-step-ico' });
    const detail = h('span', { class: 'imp-step-detail' });
    const el = h('li', { class: 'imp-step is-wait' }, ico, h('span', { class: 'imp-step-name' }, label), detail);
    return {
      el,
      set(stateName, text = '') {
        el.className = 'imp-step is-' + stateName;
        ico.replaceChildren(stateName === 'done' ? icon('checkBold', 14) : stateName === 'fail' ? icon('close', 14) : stateName === 'run' ? h('i', { class: 'spin imp-spin' }) : '');
        detail.textContent = text;
      }
    };
  }

  async function runImport() {
    if (state.running) return;
    const plan = includedPlan();
    state.running = true; state.stop = false;
    setup.inert = true; setup.classList.add('is-running');
    resultCard.hidden = true; progressCard.hidden = false;
    paintAction();

    const labelOf = { base: t('imp.stepBase'), orders: t('imp.stepOrders'), items: t('imp.stepItems') };
    const perKind = {};
    plan.batches.forEach((b) => { perKind[b.kind] = (perKind[b.kind] || 0) + 1; });
    const seen = {};
    const steps = plan.batches.map((b) => {
      seen[b.kind] = (seen[b.kind] || 0) + 1;
      const name = perKind[b.kind] > 1 ? `${labelOf[b.kind]} (${t('imp.part', { i: seen[b.kind], n: perKind[b.kind] })})` : labelOf[b.kind];
      return stepEl(name);
    });
    const doMigrate = state.migrate && plan.totals.groupPhotos > 0;
    const migStep = doMigrate ? stepEl(t('imp.stepMigrate')) : null;
    const stopBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', hidden: true }, t('imp.stop'));
    stopBtn.addEventListener('click', () => { state.stop = true; stopBtn.disabled = true; });
    const list = h('ol', { class: 'imp-steps' }, ...steps.map((s) => s.el), migStep ? migStep.el : null);
    const bar = h('div', { class: 'imp-bar' }, h('i'));
    const total = steps.length + (migStep ? 1 : 0);
    const setBar = (done) => { bar.firstChild.style.width = `${Math.round((done / total) * 100)}%`; };
    progressCard.replaceChildren(h('h2', { class: 'imp-h' }, t('imp.progress')), bar, list, h('div', { class: 'imp-stop' }, stopBtn));
    progressCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    let stats = null;
    let idx = 0;
    try {
      for (const b of plan.batches) {
        steps[idx].set('run');
        const r = await api('importData', { data: b.data }, { timeout: 180000, retries: 1 });
        stats = W.mergeStats(stats, r);
        steps[idx].set('done', String(b.count));
        idx++;
        setBar(idx);
      }
    } catch (e) {
      if (steps[idx]) steps[idx].set('fail', errorText(e));
      if (e instanceof ApiError && e.code === 'UNAUTHORIZED') toast(t('imp.needAdmin'), 'error', 6000);
      finish(null, null, plan, errorText(e));
      return;
    }

    let mig = null;
    if (migStep) {
      stopBtn.hidden = false;
      mig = await migratePhotos(migStep, setBar, total);
      stopBtn.hidden = true;
    }
    finish(stats, mig, plan, '');
  }

  /** Переносить фото груп частинами по 5, пропускаючи ті, що не вдалося. */
  async function migratePhotos(step, setBar, total) {
    const out = { migrated: 0, failed: [], remaining: null };
    step.set('run', t('imp.migrating', { done: 0, left: '…' }));
    try {
      for (;;) {
        if (state.stop) break;
        const r = await api('migrateWixPhotos', { limit: 5, skip: out.failed.length }, { timeout: 120000, retries: 0 });
        out.migrated += r.migrated;
        out.failed.push(...(r.failed || []));
        out.remaining = r.remaining;
        step.set('run', t('imp.migrating', { done: out.migrated, left: Math.max(0, r.remaining - out.failed.length) }));
        if (r.migrated + (r.failed || []).length === 0) break;
      }
      step.set(out.failed.length || state.stop ? 'fail' : 'done', t('imp.migrating', { done: out.migrated, left: out.remaining === null ? '?' : out.remaining }));
    } catch (e) {
      step.set('fail', errorText(e));
      out.error = errorText(e);
    }
    setBar(total);
    return out;
  }

  function summaryRow(label, s) {
    return h('li', { class: 'imp-res-row' }, h('span', null, label), h('b', null, s));
  }

  function finish(stats, mig, plan, errorMessage) {
    state.running = false;
    setup.inert = false; setup.classList.remove('is-running');
    paintAction();
    if (errorMessage) {
      resultCard.replaceChildren(
        h('div', { class: 'note note-error' }, icon('info', 18), h('div', null,
          h('strong', null, t('imp.failTitle')), h('p', null, t('imp.failText', { error: errorMessage })))));
      resultCard.hidden = false;
      resultCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    const pair = (s) => [s.added ? t('imp.resAdded', { n: s.added }) : '', s.updated ? t('imp.resUpdated', { n: s.updated }) : ''].filter(Boolean).join(', ') || '0';
    const rows = [
      plan.totals.albums || stats.albums.added + stats.albums.updated ? summaryRow(t('imp.resAlbums'), pair(stats.albums)) : null,
      plan.totals.orders ? summaryRow(t('imp.resOrders'), pair(stats.orders)) : null,
      plan.totals.items ? summaryRow(t('imp.resItems'), pair(stats.items)) : null,
      plan.totals.groupPhotos ? summaryRow(t('imp.resPhotos'), pair(stats.groupPhotos)) : null,
      stats.prices ? summaryRow(t('imp.resPrices'), t('imp.resPricesSaved', { n: stats.prices })) : null
    ];
    const extra = [];
    if (stats.warnings.length) {
      extra.push(h('details', { class: 'imp-warns', open: true },
        h('summary', null, t('imp.resWarnings', { n: stats.warnings.length })),
        h('ul', null, stats.warnings.slice(0, 200).map((w) => h('li', null, w)))));
    }
    let contBtn = null;
    if (mig) {
      if (mig.failed.length) {
        extra.push(h('details', { class: 'imp-warns', open: true },
          h('summary', null, t('imp.resFailed', { n: mig.failed.length })),
          h('ul', null, mig.failed.map((f) => h('li', null, `${f.kindergarten} — ${f.group}: ${f.error}`)))));
      }
      if (mig.remaining) {
        extra.push(h('p', { class: 'imp-hint' }, t('imp.resMigrateLeft', { n: mig.remaining })));
        contBtn = h('button', { class: 'btn btn-outline', type: 'button' }, t('imp.continueMigrate'));
        contBtn.addEventListener('click', () => { state.migrate = true; contBtn.disabled = true; continueMigration(); });
      }
    }
    resultCard.replaceChildren(
      h('div', { class: 'imp-done' }, h('span', { class: 'imp-done-ico' }, icon('checkBold', 20)), h('h2', { class: 'imp-h' }, t('imp.done'))),
      h('ul', { class: 'imp-res' }, rows),
      ...extra,
      h('div', { class: 'imp-res-actions' }, contBtn, h('a', { class: 'btn btn-primary', href: 'admin.html' }, t('imp.toAdmin'))));
    resultCard.hidden = false;
    resultCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function continueMigration() {
    state.running = true; state.stop = false; setup.inert = true;
    const step = stepEl(t('imp.stepMigrate'));
    const bar = h('div', { class: 'imp-bar' }, h('i'));
    const stopBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, t('imp.stop'));
    stopBtn.addEventListener('click', () => { state.stop = true; stopBtn.disabled = true; });
    progressCard.replaceChildren(h('h2', { class: 'imp-h' }, t('imp.progress')), bar, h('ol', { class: 'imp-steps' }, step.el), h('div', { class: 'imp-stop' }, stopBtn));
    progressCard.hidden = false;
    const mig = await migratePhotos(step, () => { bar.firstChild.style.width = '100%'; }, 1);
    state.running = false; setup.inert = false;
    finish({ albums: { added: 0, updated: 0 }, orders: { added: 0, updated: 0 }, items: { added: 0, updated: 0 }, groupPhotos: { added: 0, updated: 0 }, prices: 0, warnings: [] },
      mig, { totals: { albums: 0, orders: 0, items: 0, groupPhotos: 0 } }, '');
  }

  changed();
}
