import ChuGL from 'https://cdn.jsdelivr.net/npm/webchugl/+esm';

var ck = await ChuGL.init({
    canvas: document.getElementById('canvas'),
    whereIsChuGL: '../../src/',
});

await ck.runFile('./main.ck');

// ── Fetch USGS earthquake data ──────────────────────────────

var API_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

try {
    var response = await fetch(API_URL);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    var data = await response.json();

    var features = data.features;
    if (!features || features.length === 0) {
        console.warn('[Earthquake] No data');
    } else {
        var magnitudes = [];
        var lats = [];
        var lngs = [];

        for (var i = 0; i < features.length; i++) {
            var props = features[i].properties;
            var coords = features[i].geometry.coordinates;
            magnitudes.push(props.mag || 0);
            lngs.push(coords[0]);
            lats.push(coords[1]);
        }

        ck.setFloatArray('magnitudes', magnitudes);
        ck.setFloatArray('lats', lats);
        ck.setFloatArray('lngs', lngs);
        ck.setInt('dataCount', features.length);

        console.log('[Earthquake] Loaded ' + features.length + ' events');
    }
} catch (err) {
    console.error('[Earthquake] Fetch failed:', err.message);
}
