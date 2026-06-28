const API_BASE = "https://afzaffan-atmosage-api.hf.space";

function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function extractHSI(wxData, fallback = 28.0) {
    if (wxData && wxData.current && wxData.current.apparent_temperature !== undefined && wxData.current.apparent_temperature !== null) {
        return wxData.current.apparent_temperature;
    }
    return fallback;
}

function getDistrictName(props) {
    return (props.WADMKK || props.NAMOBJ || props.KAB_KOTA || props.NAME_2 || props.kabupaten || props.name || "Wilayah Tidak Diketahui").toUpperCase();
}

function normalizeName(name) {
    if (!name) return "";
    return name.toUpperCase().replace(/KABUPATEN\s/g, "").replace(/KAB\.\s/g, "").replace(/KAB\s/g, "").replace(/KOTA\s/g, "").replace(/ADMINISTRASI\s/g, "").trim();
}

let currentLat = -2.5489; 
let currentLon = 118.0149;
let simLiveScore = null;

// --- 0. FITUR HIDE SIDEBAR ---
document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('collapsed');
    setTimeout(() => { if(map) map.invalidateSize(); if(forecastChart) forecastChart.resize(); }, 350);
});

// --- 1. INISIALISASI PETA LEAFLET NATIVE ---
const map = L.map('map').setView([-2.5489, 118.0149], 5);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap & CARTO' }).addTo(map);

// --- 2. INISIALISASI SEMUA GRAFIK ---
Chart.defaults.color = '#64748b'; Chart.defaults.font.family = "'Inter', sans-serif"; Chart.defaults.scale.grid.color = '#f1f5f9';
let forecastChart, featureChart, trendChart;

function initCharts() {
    forecastChart = new Chart(document.getElementById('forecastChart').getContext('2d'), {
        type: 'line', data: { labels: [], datasets: [{ label: 'Skor AARI', data: [], borderColor: '#2563eb', backgroundColor: 'rgba(37, 99, 235, 0.15)', borderWidth: 2, tension: 0.4, fill: true, pointRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { display: false } } }
    });

    const factorOptions = { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } };
    if(document.getElementById('featureChart')) featureChart = new Chart(document.getElementById('featureChart').getContext('2d'), { type: 'bar', data: { labels: [], datasets: [{ data: [], borderRadius: 6 }] }, options: factorOptions });

    const trendDates = Array.from({length: 30}, (_, i) => { let d = new Date(); d.setDate(d.getDate() - (29 - i)); return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }); });
    const trendData = Array.from({length: 30}, () => Math.floor(Math.random() * 20) + 35); 
    if(document.getElementById('trendChart')) trendChart = new Chart(document.getElementById('trendChart').getContext('2d'), {
        type: 'line', data: { labels: trendDates, datasets: [{ label: 'Rata-rata Nasional', data: trendData, borderColor: '#16a34a', backgroundColor: 'rgba(22, 163, 74, 0.1)', borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } }, plugins: { legend: { display: false } } }
    });
}
initCharts();

fetchWithTimeout(`${API_BASE}/features`).then(r => r.json()).then(data => {
    if(data.status === 'success') {
        const labels = Object.keys(data.data); const vals = Object.values(data.data); const maxVal = Math.max(...vals);
        const bgColors = vals.map(v => { let pct = Math.max(0, Math.min(1, v / (maxVal || 1))); let hue = (1 - pct) * 120; return `hsl(${hue}, 70%, 55%)`; });
        if(featureChart) { featureChart.data.labels = labels; featureChart.data.datasets[0].data = vals; featureChart.data.datasets[0].backgroundColor = bgColors; featureChart.update(); }
    }
}).catch(err => console.error("Flask API tidak terhubung"));


// --- 3. LOGIKA TOP 10 & KPI ---
let globalProvinceResults = [];

function updateDashboardMetrics() {
    if (globalProvinceResults.length === 0) return;
    const uniqueResults = Array.from(new Map(globalProvinceResults.map(item => [item.name, item])).values());
    uniqueResults.sort((a, b) => b.score - a.score);

    let totalScore = 0; let countTinggi = 0; let countSangatTinggi = 0;
    uniqueResults.forEach(item => {
        totalScore += item.score;
        if (item.score >= 75) countSangatTinggi++;
        else if (item.score >= 50) countTinggi++;
    });

    let avgScore = (totalScore / uniqueResults.length).toFixed(1);
    document.getElementById('kpi-avg').innerHTML = `${avgScore} <span>(Live AI)</span>`;
    document.getElementById('kpi-tinggi').innerHTML = `${countTinggi} <span>Titik</span>`;
    document.getElementById('kpi-sangat-tinggi').innerHTML = `${countSangatTinggi} <span>Titik</span>`;

    if (uniqueResults.length > 0) checkAlert(uniqueResults[0].score, uniqueResults[0].name);

    const top10 = uniqueResults.slice(0, 10);
    const container = document.getElementById('top10-list');
    if (container) {
        container.innerHTML = "";
        top10.forEach((r, i) => {
            container.innerHTML += `<div class="top10-item"><div class="top10-rank">${i+1}</div><div class="top10-info"><h4 style="font-size:12.5px;">${r.name}</h4><p>Status: <span style="color:${r.color}; font-weight:600;">${r.cat}</span></p></div><div class="top10-score">${r.score}</div></div>`;
        });
    }

    populateGlobalDropdowns();
}

function getRiskColor(category) {
    if(category === "SANGAT RENDAH") return "#16a34a"; // 0-20
    if(category === "RENDAH") return "#16a34a"; // 20-40
    if(category === "SEDANG") return "#f59e0b"; // 40-60
    if(category === "TINGGI") return "#f97316"; // 60-80
    if(category === "SANGAT TINGGI") return "#ef4444"; // 80-100
    return "#cbd5e1";
}

// --- 4. PEMETAAN CHOROPLETH KABUPATEN ---
let geojsonLayer;
const GEOJSON_KABUPATEN_URL = 'https://raw.githubusercontent.com/ardian28/GeoJson-Indonesia-38-Provinsi/main/Kabupaten/38%20Provinsi%20Indonesia%20-%20Kabupaten.json';

fetch(GEOJSON_KABUPATEN_URL).then(res => res.json()).then(data => {
    geojsonLayer = L.geoJSON(data, {
        style: function(feature) { return { fillColor: "#cbd5e1", weight: 0.4, color: "white", fillOpacity: 0.7, className: 'leaflet-polygon-transition' }; },
        onEachFeature: function(feature, layer) {
            layer.on('mouseover', function(e) {
                this.setStyle({ weight: 1.5, color: "#1e293b", fillOpacity: 1 });
                let n = getDistrictName(feature.properties); let s = feature.properties.live_score || "Loading AI...";
                let popUpContent = `<div style="text-align:center;"><strong>${n}</strong><br>AARI: <b style="font-size:15px;">${s}</b></div>`;
                this.bindTooltip(popUpContent, { direction: 'top', sticky: true, className: 'leaflet-tooltip' }).openTooltip();
            });
            layer.on('mouseout', function() {
                geojsonLayer.resetStyle(this);
                if(feature.properties.live_color) this.setStyle({ fillColor: feature.properties.live_color, fillOpacity: 0.85 });
                this.closeTooltip();
            });
            layer.on('click', function(e) { processLocation(getDistrictName(feature.properties), e.latlng.lat, e.latlng.lng, this); });
        }
    }).addTo(map);
    colorMapLiveAI(geojsonLayer);
});

async function colorMapLiveAI(layerGroup) {
    let layers = []; 
    layerGroup.eachLayer(l => layers.push(l));
    const chunkSize = 40; // Diperkecil agar URL Open-Meteo tidak kepanjangan

    // PERBAIKAN: Menggunakan iterasi antrean (For-Loop) dengan Delay 1 detik
    // untuk mencegah Open-Meteo memblokir request (Error 429 Too Many Requests)
    for (let i = 0; i < layers.length; i += chunkSize) {
        let chunk = layers.slice(i, i + chunkSize);
        let lats = chunk.map(l => l.getBounds().getCenter().lat.toFixed(4)).join(',');
        let lons = chunk.map(l => l.getBounds().getCenter().lng.toFixed(4)).join(',');

        try {
            // Tarik data cuaca
            const [resAq, resWx] = await Promise.all([
                fetchWithTimeout(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}&current=pm2_5,nitrogen_dioxide,ozone`).then(r => r.json()).catch(() => null),
                fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=apparent_temperature,uv_index,wind_speed_10m,wind_direction_10m,precipitation`).then(r => r.json()).catch(() => null)
            ]);

            // Ekstrak fitur
            let instances = chunk.map((_, j) => {
                let wx = Array.isArray(resWx) ? resWx[j] : resWx;
                return {
                    lat: chunk[j].getBounds().getCenter().lat,
                    lon: chunk[j].getBounds().getCenter().lng,
                    windSpeed: wx?.current?.wind_speed_10m || 0,
                    windDir: wx?.current?.wind_direction_10m || 0,
                    precipitation: wx?.current?.precipitation || 0,
                    UV: wx?.current?.uv_index || 0,
                    HSI: extractHSI(wx)
                };
            });

            // Kirim ke Backend Flask
            const predictRes = await fetchWithTimeout(`${API_BASE}/predict-batch`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ instances: instances }) 
            }).then(r => r.json());

            if (predictRes && predictRes.status === "success") {
                for (let j = 0; j < chunk.length; j++) {
                    let result = predictRes.results[j];
                    chunk[j].feature.properties.live_score = Math.round(result.score);
                    chunk[j].feature.properties.live_color = result.color;
                    chunk[j].setStyle({ fillColor: result.color, fillOpacity: 0.85 });
                    
                    globalProvinceResults.push({ 
                        lat: instances[j].lat, lon: instances[j].lon, 
                        name: getDistrictName(chunk[j].feature.properties), 
                        score: Math.round(result.score), cat: result.category, color: result.color 
                    });
                }
                updateDashboardMetrics(); // Memperbarui KPI secara bertahap saat peta mulai diwarnai
            }
            
            // JEDA (DELAY) KUNCI: Menunggu 1 detik sebelum memproses batch berikutnya
            await new Promise(resolve => setTimeout(resolve, 1000));
            
        } catch(e) {
            console.warn("Gagal merender chunk (kemungkinan 429 atau CORS)", e);
        }
    }
}

// --- 5. LOGIKA ROUTING HALAMAN ---
const pageTitles = {
    "dashboard": { title: "Dashboard Overview", subtitle: "Ringkasan Eksekutif Sistem Peringatan Dini" },
    "peta": { title: "Eksplorasi Wilayah & Peta Risiko", subtitle: "Cari dan pantau tingkat bahaya kabupaten/kota di seluruh Indonesia" },
    "forecast": { title: "Prediksi & Forecast", subtitle: "Analisis Tren Risiko 7 Hari Kedepan" },
    "atmosfer": { title: "Data Atmosfer", subtitle: "Pemantauan Kondisi Udara & Metrik Real-Time" },
    "faktor": { title: "Analisis SHAP", subtitle: "Kontribusi Fitur Utama Terhadap Skor AARI" },
    "aari": { title: "Indeks AARI", subtitle: "Detail Kalkulasi Risiko Bencana" },
    "perbandingan": { title: "Perbandingan Wilayah", subtitle: "Komparasi Parameter Cuaca & Risiko Antar Kota" },
    "skenario": { title: "Scenario Simulation", subtitle: "Simulasi Input Cuaca Ekstrem (What-If Analysis)" },
    "riwayat": { title: "Riwayat Pencarian", subtitle: "Log Aktivitas Pemantauan Anda" },
    "tentang": { title: "Tentang ATMOSAGE", subtitle: "Informasi Sistem Bencana & Sumber Data AI" },
    "metodologi": { title: "Metodologi", subtitle: "Alur Kerja (Pipeline) Machine Learning" },
    "bantuan": { title: "Pusat Bantuan", subtitle: "Panduan Penggunaan & FAQ Dashboard" }
};

const dummyPages = []; 
let resizeTimer;

function showPage(pageName) {
    document.getElementById('page-router').setAttribute('data-active-page', pageName);
    document.querySelector('.content-body').scrollTop = 0;
    if (pageName === 'riwayat') { historyPage = 1; renderHistory(); }

    if(resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if(map) map.invalidateSize(); if(forecastChart) forecastChart.resize();
        if(featureChart) featureChart.resize(); if(trendChart) trendChart.resize();
    }, 150);
}

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', function(e) {
        e.preventDefault();
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        this.classList.add('active');
        let targetPage = this.getAttribute('data-page');
        if (pageTitles[targetPage]) {
            document.getElementById('page-title-text').innerText = pageTitles[targetPage].title;
            document.getElementById('page-subtitle-text').innerText = pageTitles[targetPage].subtitle;
        }
        showPage(targetPage);
    });
});
showPage('dashboard');

// --- 6. LOGIKA RIWAYAT PENCARIAN ---
let searchHistory = JSON.parse(localStorage.getItem('atmosage_history')) || [];
let historyPage = 1;
const historyPerPage = 15;

function saveToHistory(name, score, category, color) {
    const timestamp = new Date().toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (searchHistory.length > 0 && searchHistory[0].name === name) return;
    searchHistory.unshift({ name, score, category, color, time: timestamp });
    if (searchHistory.length > 100) searchHistory.pop(); 
    localStorage.setItem('atmosage_history', JSON.stringify(searchHistory));
}

function renderHistory() {
    const listContainer = document.getElementById('history-list');
    const paginationContainer = document.getElementById('history-pagination');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    if (searchHistory.length === 0) {
        listContainer.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem;">Belum ada riwayat pencarian yang tersimpan.</td></tr>';
        if(paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    let totalPages = Math.ceil(searchHistory.length / historyPerPage);
    if (historyPage > totalPages) historyPage = totalPages;
    if (historyPage < 1) historyPage = 1;

    let startIdx = (historyPage - 1) * historyPerPage;
    let endIdx = startIdx + historyPerPage;
    let currentItems = searchHistory.slice(startIdx, endIdx);

    currentItems.forEach((item, i) => {
        let globalIdx = startIdx + i;
        listContainer.innerHTML += `
            <tr>
                <td style="color:var(--text-muted); font-weight:600;">${globalIdx + 1}</td>
                <td>${item.time}</td>
                <td style="font-weight:600; color:var(--text-dark);">${item.name}</td>
                <td><b style="color:${item.color}">${item.score}</b></td>
                <td><span style="background-color:${item.color}; color:white; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600;">${item.category}</span></td>
                <td><button class="btn-delete-history" onclick="deleteHistoryItem(${globalIdx})" title="Hapus Pencarian"><i class="fa-solid fa-trash"></i></button></td>
            </tr>`;
    });

    if(paginationContainer) {
        paginationContainer.innerHTML = '';
        if(totalPages > 1) {
            let btnPrev = document.createElement('button');
            btnPrev.className = 'page-btn'; btnPrev.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
            btnPrev.disabled = historyPage === 1;
            btnPrev.onclick = () => { historyPage--; renderHistory(); };
            paginationContainer.appendChild(btnPrev);

            for(let p=1; p<=totalPages; p++) {
                let btn = document.createElement('button');
                btn.className = `page-btn ${p === historyPage ? 'active' : ''}`; btn.innerText = p;
                btn.onclick = () => { historyPage = p; renderHistory(); };
                paginationContainer.appendChild(btn);
            }

            let btnNext = document.createElement('button');
            btnNext.className = 'page-btn'; btnNext.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
            btnNext.disabled = historyPage === totalPages;
            btnNext.onclick = () => { historyPage++; renderHistory(); };
            paginationContainer.appendChild(btnNext);
        }
    }
}

window.deleteHistoryItem = function(index) {
    if(confirm("Apakah Anda yakin ingin menghapus riwayat ini?")) {
        searchHistory.splice(index, 1);
        localStorage.setItem('atmosage_history', JSON.stringify(searchHistory));
        renderHistory();
    }
}

// --- 7. ALERT SYSTEM & HIGHLIGHT LEGEND ---
function checkAlert(score, cityName) {
    const alertBox = document.getElementById('alert-container');
    if (score >= 75) { document.getElementById('alert-city').innerText = cityName; alertBox.classList.remove('hidden'); } 
    else { alertBox.classList.add('hidden'); }
}

function highlightAARILegend(score) {
    ['legend-sangat-rendah', 'legend-rendah', 'legend-sedang', 'legend-tinggi', 'legend-sangat-tinggi'].forEach(id => {
        let el = document.getElementById(id);
        if(el) el.classList.remove('active');
    });

    let activeId = "";
    if(score < 20) activeId = "legend-sangat-rendah";
    else if(score < 40) activeId = "legend-rendah";
    else if(score < 60) activeId = "legend-sedang";
    else if(score < 80) activeId = "legend-tinggi";
    else activeId = "legend-sangat-tinggi";

    let targetEl = document.getElementById(activeId);
    if(targetEl) targetEl.classList.add('active');
}

const searchInput = document.getElementById('search-input');
const btnSearch = document.getElementById('btn-search');
const searchResults = document.getElementById('search-results');

function searchLocation() {
    const query = document.getElementById('search-input').value.trim();
    if(!query) return;
    document.getElementById('btn-search').innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    fetchWithTimeout(`${API_BASE}/api/search-city?q=${encodeURIComponent(query)}`)
    .then(res => res.json()).then(data => {
        let sr = document.getElementById('search-results'); sr.innerHTML = '';
        if(data.length === 0) { sr.innerHTML = `<li><i class="fa-solid fa-circle-xmark"></i> Wilayah tidak ditemukan di Database CSV</li>`; } 
        else {
            data.forEach(place => {
                const li = document.createElement('li'); li.innerHTML = `<i class="fa-solid fa-map-pin"></i> ${place.name}`;
                li.onclick = () => {
                    sr.classList.add('hidden'); document.getElementById('search-input').value = place.name;
                    map.setView([parseFloat(place.lat), parseFloat(place.lon)], 10);
                    processLocation(place.name, parseFloat(place.lat), parseFloat(place.lon), null);
                }; sr.appendChild(li);
            });
        }
        sr.classList.remove('hidden'); document.getElementById('btn-search').innerHTML = `Cari Wilayah`;
    }).catch(err => { document.getElementById('search-results').innerHTML = `<li>Error mengambil data lokasi</li>`; document.getElementById('search-results').classList.remove('hidden'); document.getElementById('btn-search').innerHTML = `Cari Wilayah`; });
}
if(document.getElementById('btn-search')) document.getElementById('btn-search').addEventListener('click', searchLocation);
if(document.getElementById('search-input')) document.getElementById('search-input').addEventListener('keypress', (e) => { if(e.key === 'Enter') searchLocation(); });
document.addEventListener('click', (e) => { if(document.getElementById('search-results') && !e.target.closest('.search-bar-container')) document.getElementById('search-results').classList.add('hidden'); });

function updateProgressBar(id, value, maxVal) {
    let pct = Math.min((value / maxVal) * 100, 100);
    let hue = (1 - (pct / 100)) * 120; let color = `hsl(${hue}, 85%, 45%)`;
    let status = pct > 66 ? "Bahaya" : (pct > 33 ? "Waspada" : "Normal");

    if(document.getElementById(`fa-val-${id}`)) document.getElementById(`fa-val-${id}`).innerText = value.toFixed(1);
    if(document.getElementById(`fa-bar-${id}`)) { document.getElementById(`fa-bar-${id}`).style.width = `${pct}%`; document.getElementById(`fa-bar-${id}`).style.backgroundColor = color; }
    if(document.getElementById(`fa-stat-${id}`)) { document.getElementById(`fa-stat-${id}`).innerText = status; document.getElementById(`fa-stat-${id}`).style.color = color; }
}

function processLocation(name, lat, lon, layerInstance = null) {
    currentLat = lat; currentLon = lon; 
    
    if(document.getElementById('city-name')) document.getElementById('city-name').innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memproses Data: ${name}...`;
    if(document.getElementById('aari-city-name')) document.getElementById('aari-city-name').innerHTML = `<i class="fa-solid fa-location-dot"></i> ${name}`;
    if(document.getElementById('atmos-city-name')) document.getElementById('atmos-city-name').innerText = name;
    if(document.getElementById('forecast-title')) document.getElementById('forecast-title').innerHTML = `<i class="fa-solid fa-chart-area"></i> Tren Prediksi 7 Hari - ${name}`;
    if(document.getElementById('atmos-time')) document.getElementById('atmos-time').innerText = new Date().toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

    const url_wx = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=apparent_temperature,uv_index,temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,surface_pressure,precipitation`;

    Promise.all([fetchWithTimeout(url_wx).then(r => r.json()).catch(() => null)])
        .then(([wxData]) => {
            const uv = wxData?.current?.uv_index || 0; const hsi = extractHSI(wxData);
            const temp2m = wxData?.current?.temperature_2m; const humid = wxData?.current?.relative_humidity_2m;
            const windSpeed = wxData?.current?.wind_speed_10m || 0; const windDir = wxData?.current?.wind_direction_10m || 0;
            const pressure = wxData?.current?.surface_pressure; const precip = wxData?.current?.precipitation || 0;

            const payload = { lat: lat, lon: lon, windSpeed: windSpeed, windDir: windDir, precipitation: precip, UV: uv, HSI: hsi };

            fetchWithTimeout(`${API_BASE}/predict`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            }).then(res => res.json()).then(predictData => {
                if(predictData.status === "error") throw new Error("Flask Error");
                
                if(document.getElementById('city-name')) document.getElementById('city-name').innerHTML = `<i class="fa-solid fa-location-dot"></i> Wilayah Terpilih: <b>${name}</b>`;
                
                document.getElementById('risk-score').innerText = Math.round(predictData.score);
                document.getElementById('risk-category').innerText = predictData.category;
                let hexColor = getRiskColor(predictData.category);
                let degrees = (predictData.score / 100) * 360;
                // Sintaksis aman untuk lingkaran conic-gradient agar kompatibel dengan perbandingan wilayah dan semua browser 
                document.getElementById('score-gauge').style.background = `conic-gradient(${hexColor} ${degrees}deg, #e2e8f0 ${degrees}deg)`;
                document.getElementById('risk-category').style.backgroundColor = hexColor; document.getElementById('risk-category').style.color = "#fff";

                highlightAARILegend(predictData.score);

                let interpretasiDesc = "";
                if (predictData.score < 20)
                    interpretasiDesc = `Nilai AARI <b>${predictData.score.toFixed(1)}</b> menunjukkan tingkat risiko penuaan biologis berbasis atmosfer yang <b>Sangat Rendah</b>. Kondisi atmosfer memberikan tekanan lingkungan yang minimal terhadap tubuh sehingga risiko percepatan proses penuaan akibat paparan atmosfer relatif sangat kecil.`;
                else if (predictData.score < 40)
                    interpretasiDesc = `Nilai AARI <b>${predictData.score.toFixed(1)}</b> menunjukkan tingkat risiko penuaan biologis berbasis atmosfer yang <b>Rendah</b>. Kondisi atmosfer masih tergolong baik dengan potensi dampak biologis yang rendah. Aktivitas luar ruangan umumnya dapat dilakukan tanpa kekhawatiran berarti.`;
                else if (predictData.score < 60)
                    interpretasiDesc = `Nilai AARI <b>${predictData.score.toFixed(1)}</b> menunjukkan tingkat risiko penuaan biologis berbasis atmosfer yang <b>Sedang</b>. Paparan atmosfer mulai memberikan tekanan fisiologis yang dapat berkontribusi terhadap percepatan proses penuaan biologis apabila terjadi secara terus-menerus. Disarankan untuk membatasi durasi paparan yang tidak diperlukan.`;
                else if (predictData.score < 80)
                    interpretasiDesc = `Nilai AARI <b>${predictData.score.toFixed(1)}</b> menunjukkan tingkat risiko penuaan biologis berbasis atmosfer yang <b>Tinggi</b>. Kondisi atmosfer berpotensi meningkatkan stres oksidatif dan tekanan lingkungan terhadap tubuh apabila paparan berlangsung lama. Sebaiknya kurangi aktivitas luar ruangan yang berkepanjangan dan gunakan perlindungan yang sesuai.`;
                else
                    interpretasiDesc = `Nilai AARI <b>${predictData.score.toFixed(1)}</b> menunjukkan tingkat risiko penuaan biologis berbasis atmosfer yang <b>Sangat Tinggi</b>. Paparan atmosfer pada kondisi ini berpotensi memberikan tekanan biologis yang signifikan sehingga dapat meningkatkan risiko percepatan proses penuaan apabila terjadi berulang atau dalam waktu lama. Hindari paparan yang tidak perlu dan gunakan perlindungan diri yang memadai saat harus beraktivitas di luar ruangan.`;
                if (document.getElementById('aari-interpretasi-text'))
                    document.getElementById('aari-interpretasi-text').innerHTML = interpretasiDesc;

                if(layerInstance) { layerInstance.feature.properties.live_score = Math.round(predictData.score); layerInstance.feature.properties.live_color = hexColor; layerInstance.setStyle({ fillColor: hexColor, color: "#1e293b" }); }

                updateProgressBar('pm25', windSpeed, 60); updateProgressBar('no2', windDir, 360); updateProgressBar('o3', precip, 50); updateProgressBar('uv', uv, 12); updateProgressBar('hsi', hsi, 40);
                
                if(document.getElementById('atmos-temp')) document.getElementById('atmos-temp').innerText = temp2m !== undefined ? temp2m + ' °C' : '--';
                if(document.getElementById('atmos-humid')) document.getElementById('atmos-humid').innerText = humid !== undefined ? humid + ' %' : '--';
                if(document.getElementById('atmos-windspeed')) document.getElementById('atmos-windspeed').innerText = windSpeed !== undefined ? windSpeed + ' km/h' : '--';
                if(document.getElementById('atmos-winddir')) document.getElementById('atmos-winddir').innerText = windDir !== undefined ? windDir + '°' : '--';
                if(document.getElementById('atmos-pressure')) document.getElementById('atmos-pressure').innerText = pressure !== undefined ? pressure + ' hPa' : '--';
                if(document.getElementById('atmos-precip')) document.getElementById('atmos-precip').innerText = precip !== undefined ? precip + ' mm' : '--';

                forecastChart.data.labels = predictData.forecast_dates; forecastChart.data.datasets[0].data = predictData.forecast_scores;
                forecastChart.data.datasets[0].borderColor = hexColor; forecastChart.data.datasets[0].pointBorderColor = hexColor; forecastChart.update();
                saveToHistory(name, Math.round(predictData.score), predictData.category, hexColor);
            }).catch(err => {});
        }).catch(err => {});
}


// --- 8. LOGIKA PENGISIAN DROPDOWN (PERBANDINGAN & SIMULASI) ---
function populateGlobalDropdowns() {
    const sel1 = document.getElementById('comp-sel-1');
    const sel2 = document.getElementById('comp-sel-2');
    const simDatalist = document.getElementById('sim-datalist');
    
    if(sel1) sel1.innerHTML = '<option value="">-- Pilih Wilayah / Kabupaten --</option>';
    if(sel2) sel2.innerHTML = '<option value="">-- Pilih Wilayah / Kabupaten --</option>';
    if(simDatalist) simDatalist.innerHTML = '';

    const uniqueCities = Array.from(new Map(globalProvinceResults.map(item => [item.name, item])).values());

    uniqueCities.forEach((city) => {
        let valString = `${city.lat},${city.lon}`;
        if(sel1) sel1.innerHTML += `<option value="${valString}">${city.name}</option>`;
        if(sel2) sel2.innerHTML += `<option value="${valString}">${city.name}</option>`;
        if(simDatalist) simDatalist.innerHTML += `<option value="${city.name}">`;
    });
}

const sel1 = document.getElementById('comp-sel-1'); 
const sel2 = document.getElementById('comp-sel-2');
if(sel1) sel1.addEventListener('change', (e) => processCompare(e.target.value, 1, e.target));
if(sel2) sel2.addEventListener('change', (e) => processCompare(e.target.value, 2, e.target));

function processCompare(coordString, colNum, selectElement) {
    if(!coordString) return; 
    const coords = coordString.split(',');
    const lat = parseFloat(coords[0]); const lon = parseFloat(coords[1]);
    
    // Perbaikan untuk mengganti judul "Wilayah A" menjadi nama kota yang dipilih
    const cityName = selectElement.options[selectElement.selectedIndex].text;
    const titleEl = document.getElementById(`comp-title-${colNum}`);
    if(titleEl) titleEl.innerHTML = `<i class="fa-solid fa-city"></i> ${cityName}`;

    document.getElementById(`comp-score-${colNum}`).innerText = "...";
    Promise.all([
        fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=apparent_temperature,uv_index,wind_speed_10m,wind_direction_10m,precipitation`).then(r=>r.json()).catch(()=>null)
    ]).then(([wxData]) => {
        const uv = wxData?.current?.uv_index || 0; const hsi = extractHSI(wxData);
        const windSpeed = wxData?.current?.wind_speed_10m || 0; const windDir = wxData?.current?.wind_direction_10m || 0; const precip = wxData?.current?.precipitation || 0;
        
        fetchWithTimeout(`${API_BASE}/predict`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: lat, lon: lon, windSpeed: windSpeed, windDir: windDir, precipitation: precip, UV: uv, HSI: hsi })
        }).then(res => res.json()).then(predictData => {
            const hexColor = getRiskColor(predictData.category); const degrees = (predictData.score / 100) * 360;
            document.getElementById(`comp-score-${colNum}`).innerText = Math.round(predictData.score);
            document.getElementById(`comp-badge-${colNum}`).innerText = predictData.category; document.getElementById(`comp-badge-${colNum}`).style.backgroundColor = hexColor; document.getElementById(`comp-badge-${colNum}`).style.color = "#fff";
            document.getElementById(`comp-gauge-${colNum}`).style.background = `conic-gradient(${hexColor} ${degrees}deg, #e2e8f0 ${degrees}deg)`;
            document.getElementById(`c${colNum}-pm25`).innerText = windSpeed.toFixed(1) + " km/h"; document.getElementById(`c${colNum}-no2`).innerText = windDir.toFixed(0) + "°";
            document.getElementById(`c${colNum}-o3`).innerText = precip.toFixed(1) + " mm"; document.getElementById(`c${colNum}-uv`).innerText = uv.toFixed(1); document.getElementById(`c${colNum}-hsi`).innerText = hsi.toFixed(1);
        });
    });
}

// --- 9. LOGIKA SCENARIO SIMULATION ---
let simBaselineParams = {};
let simSearchInput = document.getElementById('sim-search-input');

if(simSearchInput) {
    simSearchInput.addEventListener('change', function(e) {
        let val = e.target.value.trim().toUpperCase();
        let city = globalProvinceResults.find(c => c.name.toUpperCase() === val || c.name.toUpperCase().includes(val));
        
        if(city) {
            currentLat = city.lat;
            currentLon = city.lon;
            this.value = city.name;
            
            document.getElementById('sim-selected-info').style.display = 'block';
            document.getElementById('sim-selected-info').innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menarik baseline cuaca ${city.name}...`;

            fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=apparent_temperature,uv_index,wind_speed_10m,wind_direction_10m,precipitation`)
            .then(r=>r.json()).then(wxData => {
                let windS = wxData?.current?.wind_speed_10m || 0;
                let windD = wxData?.current?.wind_direction_10m || 0;
                let prec = wxData?.current?.precipitation || 0;
                let uvI = wxData?.current?.uv_index || 0;
                let hsiI = extractHSI(wxData);

                document.getElementById('sim-val-windspeed').value = windS; document.getElementById('sim-txt-windspeed').innerText = windS;
                document.getElementById('sim-val-winddir').value = windD; document.getElementById('sim-txt-winddir').innerText = windD;
                document.getElementById('sim-val-precip').value = prec; document.getElementById('sim-txt-precip').innerText = prec;
                document.getElementById('sim-val-uv').value = uvI; document.getElementById('sim-txt-uv').innerText = uvI;
                document.getElementById('sim-val-hsi').value = hsiI; document.getElementById('sim-txt-hsi').innerText = hsiI.toFixed(1);

                document.getElementById('sim-selected-info').innerHTML = `<i class="fa-solid fa-check-circle" style="color:var(--primary);"></i> Baseline ${city.name} dimuat. Parameter siap disimulasikan.`;

                fetchWithTimeout(`${API_BASE}/predict`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat: city.lat, lon: city.lon, windSpeed: windS, windDir: windD, precipitation: prec, UV: uvI, HSI: hsiI }) })
                .then(r=>r.json()).then(data => { 
                    simLiveScore = data.score; 
                    simBaselineParams = { score: data.score, hsi: hsiI, uv: uvI, precip: prec, windSpeed: windS };
                });
            }).catch(() => {});
        }
    });
}

const simParams = ['windspeed', 'winddir', 'precip', 'uv', 'hsi'];
simParams.forEach(param => {
    const slider = document.getElementById(`sim-val-${param}`); const textLabel = document.getElementById(`sim-txt-${param}`);
    if(slider) slider.addEventListener('input', (e) => { textLabel.innerText = e.target.value; });
});

let btnSimulate = document.getElementById('btn-simulate');
if(btnSimulate) {
    btnSimulate.addEventListener('click', function() {
        if(Object.keys(simBaselineParams).length === 0) { alert("Silakan pilih Wilayah Simulasi terlebih dahulu!"); return; }

        const btn = this; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menghitung...`;
        
        // Membawa parameter is_simulation beserta baseline aslinya untuk diproses Pearson
        const payload = {
            lat: currentLat, lon: currentLon,
            windSpeed: parseFloat(document.getElementById('sim-val-windspeed').value),
            windDir: parseFloat(document.getElementById('sim-val-winddir').value),
            precipitation: parseFloat(document.getElementById('sim-val-precip').value),
            UV: parseFloat(document.getElementById('sim-val-uv').value),
            HSI: parseFloat(document.getElementById('sim-val-hsi').value),
            is_simulation: true,
            baseline_score: simBaselineParams.score,
            base_hsi: simBaselineParams.hsi,
            base_uv: simBaselineParams.uv,
            base_precip: simBaselineParams.precip,
            base_windSpeed: simBaselineParams.windSpeed
        };

        fetchWithTimeout(`${API_BASE}/predict`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(res => res.json()).then(data => {
            const simScore = Math.round(data.score);
            document.getElementById('sim-risk-score').innerText = simScore; document.getElementById('sim-risk-category').innerText = data.category;
            let hexColor = getRiskColor(data.category); let degrees = (data.score / 100) * 360;
            document.getElementById('sim-score-gauge').style.background = `conic-gradient(${hexColor} ${degrees}deg, #e2e8f0 ${degrees}deg)`;
            document.getElementById('sim-risk-category').style.backgroundColor = hexColor;

            const deltaText = document.getElementById('sim-delta-text');
            if(simLiveScore !== null) {
                let delta = simScore - Math.round(simLiveScore);
                if(delta > 0) deltaText.innerHTML = `<span class="delta-pos" style="color: #ef4444;"><i class="fa-solid fa-arrow-trend-up"></i> +${delta}</span> poin dari baseline asli`;
                else if (delta < 0) deltaText.innerHTML = `<span class="delta-neg" style="color: #16a34a;"><i class="fa-solid fa-arrow-trend-down"></i> ${delta}</span> poin dari baseline asli`;
                else deltaText.innerHTML = `<span><i class="fa-solid fa-equals"></i> Tidak ada perubahan</span> skor`;
            }
            btn.innerHTML = `<i class="fa-solid fa-play"></i> Jalankan Simulasi AARI`;
        }).catch(err => {
            btn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Gagal Simulasi`;
            setTimeout(() => btn.innerHTML = `<i class="fa-solid fa-play"></i> Jalankan Simulasi AARI`, 2000);
        });
    });
}
