import { ok, error } from '../utils/responses.js';

// Simple city mapping for development
// In production, this would call an external geocoding API like Google Maps, Amap, etc.
const CITY_BOUNDARIES = [
    { code: 'beijing', name: '北京', lat: 39.9042, lng: 116.4074, radius: 100 },
    { code: 'shanghai', name: '上海', lat: 31.2304, lng: 121.4737, radius: 80 },
    { code: 'guangzhou', name: '广州', lat: 23.1291, lng: 113.2644, radius: 60 },
    { code: 'shenzhen', name: '深圳', lat: 22.5431, lng: 114.0579, radius: 50 },
    { code: 'hangzhou', name: '杭州', lat: 30.2741, lng: 120.1551, radius: 50 },
    { code: 'suzhou', name: '苏州', lat: 31.2989, lng: 120.5853, radius: 40 },
    { code: 'nanjing', name: '南京', lat: 32.0603, lng: 118.7969, radius: 50 },
    { code: 'chengdu', name: '成都', lat: 30.5728, lng: 104.0668, radius: 60 },
    { code: 'chongqing', name: '重庆', lat: 29.4316, lng: 106.9123, radius: 80 },
    { code: 'xian', name: '西安', lat: 34.3416, lng: 108.9398, radius: 50 },
    { code: 'wuhan', name: '武汉', lat: 30.5928, lng: 114.3055, radius: 60 },
    { code: 'tianjin', name: '天津', lat: 39.3434, lng: 117.3616, radius: 60 },
    { code: 'qingdao', name: '青岛', lat: 36.0671, lng: 120.3826, radius: 40 },
    { code: 'dalian', name: '大连', lat: 38.9140, lng: 121.6147, radius: 40 },
    { code: 'xiamen', name: '厦门', lat: 24.4798, lng: 118.0894, radius: 30 },
    { code: 'sanya', name: '三亚', lat: 18.2528, lng: 109.5119, radius: 30 },
];

function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function findNearestCity(lat, lng) {
    let nearest = null;
    let minDistance = Infinity;

    for (const city of CITY_BOUNDARIES) {
        const distance = haversineDistance(lat, lng, city.lat, city.lng);
        if (distance < city.radius && distance < minDistance) {
            minDistance = distance;
            nearest = city;
        }
    }

    // If no city within radius, return the nearest one
    if (!nearest) {
        for (const city of CITY_BOUNDARIES) {
            const distance = haversineDistance(lat, lng, city.lat, city.lng);
            if (distance < minDistance) {
                minDistance = distance;
                nearest = city;
            }
        }
    }

    return nearest;
}

export default async function geoRoutes(app) {
    // POST /functions/v1/geo.cityFromLocation
    app.post('/functions/v1/geo.cityFromLocation', async (req, reply) => {
        const { lat, lng } = req.body || {};

        if (typeof lat !== 'number' || typeof lng !== 'number') {
            return error(reply, 'INVALID_REQUEST', 'lat and lng are required numbers', 400);
        }

        try {
            const city = findNearestCity(lat, lng);

            if (city) {
                return ok(reply, {
                    cityCode: city.code,
                    cityName: city.name,
                    lat: city.lat,
                    lng: city.lng,
                });
            }

            // Fallback - return a default city
            return ok(reply, {
                cityCode: 'unknown',
                cityName: '未知城市',
                lat,
                lng,
            });
        } catch (err) {
            req.log.error(err);
            return error(reply, 'SERVER_ERROR', 'Failed to determine city from location', 500);
        }
    });
}
