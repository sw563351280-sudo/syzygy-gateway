'use strict';

const LOCATION_MAX_AGE_MS = 30 * 60 * 1000;

function validTimestamp(value) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function locationTimestamp(state) {
    return validTimestamp(state?.location?.captured_at)
        || validTimestamp(state?.location?.received_at)
        || validTimestamp(state?.captured_at)
        || validTimestamp(state?.received_at);
}

function locationAge(state, now = Date.now()) {
    const timestamp = locationTimestamp(state);
    return timestamp ? Math.max(0, Number(now) - Date.parse(timestamp)) : Infinity;
}

function locationIsFresh(state, now = Date.now(), maxAge = LOCATION_MAX_AGE_MS) {
    const latitude = state?.location?.latitude, longitude = state?.location?.longitude;
    return Boolean(state?.location && latitude !== null && latitude !== '' && longitude !== null && longitude !== ''
        && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && locationAge(state, now) <= maxAge);
}

function preserveLegacyLocationTimestamp(state) {
    if (!state?.location || state.location.captured_at || state.location.received_at) return false;
    const timestamp = validTimestamp(state.captured_at) || validTimestamp(state.received_at);
    if (!timestamp) return false;
    state.location.captured_at = timestamp;
    return true;
}

function cityLabel(value) {
    const address = value?.address || {};
    return [address.city, address.town, address.municipality, address.county, address.state_district, address.state]
        .map(item => String(item || '').trim()).find(Boolean) || '';
}

module.exports = { LOCATION_MAX_AGE_MS, cityLabel, locationAge, locationIsFresh, locationTimestamp, preserveLegacyLocationTimestamp, validTimestamp };
