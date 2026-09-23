/* <israel-map> — real OpenStreetMap cartography of Israel via Leaflet, brand-tinted,
   with the seven BeautyFind regions marked and an ambient region tour.
   Requires the pinned leaflet.css + leaflet.js tags in the document head.
   Deliberately light DOM (no shadow root) so leaflet.css applies. */
(function () {
  const REGIONS = [
    { rs: 'north',     name: 'צפון',    lat: 32.96, lon: 35.42, cities: 11, rad: 34000 },
    { rs: 'haifa',     name: 'חיפה',    lat: 32.74, lon: 35.02, cities: 11, rad: 22000 },
    { rs: 'sharon',    name: 'שרון',    lat: 32.30, lon: 34.92, cities: 9,  rad: 19000 },
    { rs: 'dan',       name: 'גוש דן',  lat: 32.05, lon: 34.85, cities: 12, rad: 18000 },
    { rs: 'shfela',    name: 'שפלה',    lat: 31.86, lon: 34.85, cities: 8,  rad: 19000 },
    { rs: 'jerusalem', name: 'ירושלים', lat: 31.78, lon: 35.18, cities: 6,  rad: 17000 },
    { rs: 'south',     name: 'דרום',    lat: 31.00, lon: 34.90, cities: 12, rad: 52000 }
  ];
  const BOUNDS = [[29.49, 34.27], [33.34, 35.90]];
  const SS = 3; // supersample factor
  const STYLE_ID = 'bfm-style';
  const CSS = `
.bfm-frame{direction:rtl;display:flex;flex-direction:column;align-items:flex-start}
.bfm-card{width:clamp(320px,44vw,560px);padding:8px;border-radius:20px;background:#ffffff;
  box-shadow:0 24px 52px rgba(12,36,62,.14);transition:box-shadow .3s;
  opacity:0;animation:bfmIn 1.2s ease .15s forwards,bfmFloat 15s ease-in-out 1.4s infinite}
.bfm-card:hover{box-shadow:0 32px 66px rgba(12,36,62,.2)}
@keyframes bfmIn{to{opacity:1}}
@keyframes bfmFloat{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-10px,0)}}
.bfm-shell{position:relative;width:100%;aspect-ratio:5/4;border-radius:14px;overflow:hidden;
  background:#EDF1F3;perspective:1600px;perspective-origin:50% 44%}
.bfm-plane{position:absolute;inset:-40% -14%;transform:rotateX(30deg) rotateZ(-38deg);transform-origin:50% 50%}
.bfm-scale{position:absolute;left:0;top:0;transform-origin:0 0}
.bfm-map{position:absolute;inset:0;background:transparent}
.bfm-map .leaflet-tile-pane{filter:saturate(.88) brightness(1.04) contrast(.97)}
.bfm-map .leaflet-container{background:transparent;font-family:'Assistant',system-ui,sans-serif}
.bfm-veil{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(to left,transparent 52%,rgba(108,168,214,.26) 96%),
             radial-gradient(120% 95% at 55% 40%,transparent 52%,rgba(255,255,255,.34))}
.bfm-credit{margin-top:6px;font-size:11px;color:#8A96A3;direction:ltr;
  font-family:'Assistant',system-ui,sans-serif}
.bfm-credit a{color:#5B6B7B;text-decoration:underline}
.bfm-pin{background:none!important;border:0!important}
.bfm-pin i{display:block;width:30px;height:30px;margin:30px;border-radius:50%;background:#0C243E;
  transform:rotateZ(38deg) rotateX(-30deg);box-shadow:0 9px 21px rgba(12,36,62,.45),0 0 0 7.5px rgba(255,255,255,.92);
  transition:width .35s cubic-bezier(.2,.8,.2,1),height .35s cubic-bezier(.2,.8,.2,1),margin .35s cubic-bezier(.2,.8,.2,1),background .35s ease,box-shadow .35s ease}
.bfm-pin i::after{content:'';position:absolute;inset:0;border-radius:50%;
  border:4.5px solid rgba(20,179,198,.85);animation:bfmRing 3.6s ease-out infinite}
@keyframes bfmRing{0%{transform:scale(1);opacity:0}25%{opacity:.8}100%{transform:scale(4.2);opacity:0}}
.bfm-pin.on i{width:48px;height:48px;margin:21px;background:#14B3C6;
  box-shadow:0 12px 30px rgba(12,36,62,.4),0 0 0 9px rgba(255,255,255,.95),0 0 54px rgba(20,179,198,.6)}
.bfm-pin:focus-visible{outline:6px solid #14B3C6;outline-offset:9px;border-radius:50%}
.bfm-label{position:absolute;z-index:620;pointer-events:none;display:flex;align-items:center;
  flex-direction:row-reverse;opacity:0;
  transition:transform .65s cubic-bezier(.2,.8,.2,1),opacity .4s ease}
.bfm-label.show{opacity:1}
.bfm-label span{display:inline-flex;align-items:center;height:90px;padding:0 39px;border-radius:999px;
  background:#0C243E;color:#ffffff;font-size:42px;font-weight:700;white-space:nowrap;
  transform:rotateZ(38deg) rotateX(-30deg);box-shadow:0 24px 66px rgba(6,20,33,.32)}
.bfm-label b{display:block;width:54px;height:4.5px;background:#14B3C6;flex:none;
  box-shadow:0 3px 9px rgba(255,255,255,.8)}
.bfm-readout{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:18px;
  font-size:14px;color:#5B6B7B;font-family:'Assistant',system-ui,sans-serif}
.bfm-readout strong{font-family:'Frank Ruhl Libre',serif;font-weight:500;font-size:21px;color:#0C243E}
.bfm-readout em{font-style:normal;color:#0B7A87;font-weight:700}
.bfm-fail{padding:28px 0;color:#5B6B7B;font-size:15px;line-height:1.7}
@media (prefers-reduced-motion:reduce){
  .bfm-card,.bfm-pin i::after{animation:none!important}.bfm-card{opacity:1;transform:none}
  .bfm-plane{transform:rotateX(30deg) rotateZ(-38deg)}
  .bfm-label{transition:none}
}`;

  const ready = () => new Promise(res => {
    const tick = () => (window.L && window.L.map ? res() : setTimeout(tick, 40));
    tick();
  });

  class IsraelMap extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      if (!document.getElementById(STYLE_ID)) {
        const st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = CSS;
        document.head.appendChild(st);
      }
      this.innerHTML = `<div class="bfm-frame">
        <div class="bfm-card"><div class="bfm-shell"><div class="bfm-plane"><div class="bfm-scale"><div class="bfm-map"></div><div class="bfm-veil"></div>
          <div class="bfm-label" aria-hidden="true"></div></div></div></div></div>
        <div class="bfm-readout"><strong></strong><em></em></div>
        <div class="bfm-credit">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors</div></div>`;
      this.shell = this.querySelector('.bfm-shell');
      this.plane = this.querySelector('.bfm-plane');
      this.scaleEl = this.querySelector('.bfm-scale');
      this.mapEl = this.querySelector('.bfm-map');
      this.labelEl = this.querySelector('.bfm-label');
      this.rName = this.querySelector('.bfm-readout strong');
      this.rMeta = this.querySelector('.bfm-readout em');
      this.boot();
    }

    disconnectedCallback() {
      clearInterval(this._tour); clearTimeout(this._idle);
      if (this._ro) this._ro.disconnect();
      if (this.map) this.map.remove();
    }

    async boot() {
      try {
        await ready();
        await new Promise(r => requestAnimationFrame(r));
        this.draw();
      } catch (e) {
        this.shell.innerHTML = '<div class="bfm-fail">לא ניתן לטעון את המפה כרגע.</div>';
      }
    }

    draw() {
      const L = window.L;
      const map = L.map(this.mapEl, {
        zoomControl: false, attributionControl: false,
        dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
        touchZoom: false, boxZoom: false, keyboard: false, tap: false,
        zoomSnap: 0, fadeAnimation: true
      });
      this.map = map;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18, detectRetina: true
      }).addTo(map);
      const bounds = L.latLngBounds(BOUNDS);

      this.circles = [];
      this.pins = [];
      REGIONS.forEach((r, i) => {
        const circle = L.circle([r.lat, r.lon], {
          radius: r.rad, stroke: false, fillColor: '#14B3C6', fillOpacity: 0,
          interactive: false, className: 'bfm-blob'
        }).addTo(map);
        this.circles.push(circle);
        const marker = L.marker([r.lat, r.lon], {
          icon: L.divIcon({ className: 'bfm-pin', html: '<i></i>', iconSize: [90, 90], iconAnchor: [45, 45] }),
          keyboard: true, title: `אזור ${r.name}`, alt: `אזור ${r.name}, ${r.cities} ערים`,
          riseOnHover: true
        }).addTo(map);
        marker.on('mouseover click focus', () => { this.stopTour(); this.setActive(i); });
        this.pins.push(marker);
      });

      this._fit = () => {
        this.scaleEl.style.width = Math.max(1, Math.round(this.plane.clientWidth * SS)) + 'px';
        this.scaleEl.style.height = Math.max(1, Math.round(this.plane.clientHeight * SS)) + 'px';
        this.scaleEl.style.transform = 'scale(' + (1 / SS) + ')';
        map.invalidateSize({ animate: false });
        /* Target the country's post-rotation bounding height at ~85% of the visible shell.
           bbox_h = w*sin(rz) + h*cos(rx)*cos(rz) = 0.912*h for rz=38deg, rx=30deg. */
        const hDisp = (0.90 * this.shell.clientHeight) / 0.912;
        const crs = map.options.crs;
        const nw = crs.latLngToPoint(bounds.getNorthWest(), 0);
        const se = crs.latLngToPoint(bounds.getSouthEast(), 0);
        const h0 = Math.abs(se.y - nw.y) || 1;
        let z = Math.log2((hDisp * SS) / h0);
        z = Math.max(2, Math.min(17, z));
        map.setView(bounds.getCenter(), z, { animate: false });
        if (this.active != null) this.place(this.active);
      };
      this._fit();
      this._ro = new ResizeObserver(this._fit);
      this._ro.observe(this.plane);

      this.setActive(3);
      if (!matchMedia('(prefers-reduced-motion:reduce)').matches) this.startTour(3);
    }

    place(i) {
      const r = REGIONS[i];
      const p = this.map.latLngToContainerPoint([r.lat, r.lon]);
      const w = this.scaleEl.clientWidth;
      const inward = p.x < w * 0.5;
      this.labelEl.style.left = '0px';
      this.labelEl.style.top = '0px';
      this.labelEl.style.flexDirection = inward ? 'row' : 'row-reverse';
      const dx = inward ? p.x + 39 : p.x - 39;
      this.labelEl.style.transform =
        `translate(${inward ? dx : dx}px, ${p.y}px) translate(${inward ? '0' : '-100%'}, -50%)`;
    }

    setActive(i) {
      this.active = i;
      this.pins.forEach((m, n) => {
        const el = m.getElement();
        if (el) el.classList.toggle('on', n === i);
      });
      this.circles.forEach((c, n) => c.setStyle({ fillOpacity: n === i ? 0.3 : 0 }));
      const r = REGIONS[i];
      this.labelEl.innerHTML = `<b></b><span>${r.name}</span>`;
      this.place(i);
      this.labelEl.classList.add('show');
      this.rName.textContent = `אזור ${r.name}`;
      this.rMeta.textContent = `${r.cities} ערים באינדקס`;
    }

    startTour(from) {
      let n = from;
      clearInterval(this._tour);
      this._tour = setInterval(() => { n = (n + 1) % REGIONS.length; this.setActive(n); }, 2900);
    }
    stopTour() {
      clearInterval(this._tour); clearTimeout(this._idle);
      if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
      this._idle = setTimeout(() => this.startTour(this.active), 7000);
    }
  }

  if (!customElements.get('israel-map')) customElements.define('israel-map', IsraelMap);
})();
