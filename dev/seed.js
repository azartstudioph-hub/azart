'use strict';
// Початкові дані для локальної розробки/тестів (вигадані імена та телефони).
const DEFAULT_FORMATS = ['Друковані', 'Електронні', 'Друковані + електронні'];
const SIZES = ['10x15', '15x21', '20x30', '30x45'];

function seed(gas, { password = 'admin' } = {}) {
  gas.props.ADMIN_PASSWORD = password;
  gas.run('setup');
  const lg = gas.post({ action: 'login', password });
  if (!lg.ok) throw new Error('seed login failed');
  const token = lg.data.token;
  const call = (action, p) => {
    const r = gas.post({ action, token, ...p });
    if (!r.ok) throw new Error(`seed ${action}: ${r.error.code} ${r.error.message}`);
    return r.data;
  };
  const future = (days) => {
    const d = new Date(Date.now() + days * 86400000);
    return d.toISOString().slice(0, 10);
  };

  const a1 = call('saveAlbum', { album: {
    title: 'Новорічне свято', kindergarten: 'Сад 7', types: ['Репортаж', 'На фоні'], sizes: SIZES, formats: DEFAULT_FORMATS,
    deadline: future(18), driveFolderId: 'DEMO_GROUPS', discountEnabled: true,
    typeRanges: [
      { from: 5300, to: 5499, type: 'На фоні', group: 'Група 1' },
      { from: 5500, to: 5799, type: 'Репортаж', group: 'Група 1' }
    ]
  } }).album;
  const a2 = call('saveAlbum', { album: {
    title: 'Випускний', kindergarten: 'Сад 1', types: ['Репортаж', 'На фоні'], sizes: SIZES, formats: DEFAULT_FORMATS,
    deadline: future(10), driveFolderId: 'DEMO_FLAT', discountEnabled: false, typeRanges: []
  } }).album;
  const a3 = call('saveAlbum', { album: {
    title: 'Портрети', kindergarten: 'Сад 7', types: ['Портрет'], sizes: SIZES, formats: DEFAULT_FORMATS,
    deadline: future(25), driveFolderId: 'DEMO_PORTRAIT', discountEnabled: false, typeRanges: []
  } }).album;
  const a4 = call('saveAlbum', { album: {
    title: 'Осінній ранок (завершено)', kindergarten: 'Сад 7', types: ['Репортаж'], sizes: SIZES, formats: DEFAULT_FORMATS,
    deadline: '2020-01-01', driveFolderId: 'DEMO_FLAT', discountEnabled: false, typeRanges: []
  } }).album;

  const names = ['Коваленко Олена', 'Шевченко Андрій', 'Бондаренко Марія', 'Ткаченко Іван', 'Мельник Софія', 'Кравченко Дмитро'];
  const mk = (album, groupId, groupName, name, phone, items, extra = {}) => call('createOrder', {
    requestId: 'seed' + Math.random().toString(36).slice(2, 14) + 'xx',
    order: { albumId: album.id, groupFolderId: groupId, groupName, clientName: name, phone, comment: extra.comment || '', isFullSession: !!extra.full, items }
  });
  const it = (photo, type, size, format, count = 1) => ({ photoNumber: photo, photoType: type, photoSize: size, photoFormat: format, count });
  mk(a1, 'DEMO_G1', 'Група 1', names[0], '0501112233', [it('IMG_5301.JPG', 'На фоні', '15x21', 'Друковані', 2), it('IMG_5320.JPG', 'Репортаж', '', 'Електронні')]);
  mk(a1, 'DEMO_G1', 'Група 1', names[1], '0672223344', [it('IMG_5304.JPG', 'На фоні', '10x15', 'Друковані + електронні', 1), it('IMG_5307.JPG', 'На фоні', '20x30', 'Друковані', 1)], { comment: 'Будь ласка, друк на матовому папері' });
  mk(a1, 'DEMO_G2', 'Група 2', names[2], '0933334455', [it('IMG_5701.JPG', 'Репортаж', '30x45', 'Друковані', 3), it('IMG_5704.JPG', 'Репортаж', '15x21', 'Друковані', 6), it('IMG_5707.JPG', 'Репортаж', '', 'Електронні')]);
  mk(a2, '', '', names[3], '0634445566', [it('6040.JPG', 'На фоні', '20x30', 'Друковані + електронні', 1)]);
  mk(a3, 'DEMO_PG1', 'Група 1', names[4], '0505556677', [it('7101.JPG', 'Портрет', '15x21', 'Друковані', 1)]);
  mk(a3, 'DEMO_PG1', 'Група 1', names[5], '0676667788', [it('7102.JPG', 'Портрет', '10x15', 'Друковані', 1)], { full: true, comment: '10 фото для друку: 7101, 7103, 7105' });

  // фото груп (SVG-заглушки з dev-сервера)
  const photos = [1, 2, 3, 4, 5, 6].map((n) => ({ kindergarten: 'Сад 7', groupName: 'Група ' + n, photoUrl: `https://example.invalid/group-${n}.svg` }));
  call('importData', { data: { groupPhotos: photos } });
  return { token, albums: { a1, a2, a3, a4 } };
}

module.exports = { seed };
