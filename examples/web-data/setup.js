// Web Data Example: Earthquake Data Visualization & Sonification
// Fetches real-time earthquake data and pushes it to ChucK.

(function() {
    'use strict';

    var API_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

    console.log('[Example: web-data] Fetching earthquake data...');

    fetch(API_URL)
        .then(function(response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        })
        .then(function(data) {
            var features = data.features;
            if (!features || features.length === 0) {
                console.warn('[Example: web-data] No earthquakes found');
                return;
            }

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

            CK.setFloatArray('magnitudes', magnitudes);
            CK.setFloatArray('lats', lats);
            CK.setFloatArray('lngs', lngs);
            CK.setInt('dataCount', features.length);

            console.log('[Example: web-data] Loaded ' + features.length + ' earthquakes');
        })
        .catch(function(err) {
            console.error('[Example: web-data] Fetch failed:', err.message);
        });
})();
