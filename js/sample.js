/* SAMPLE data generator — dates are relative to today so the demo always shows a realistic mix. */
var PPASample = (function () {
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function build() {
    var S = PPAStatus, t = S.todayStr();
    function ago(d) { return S.addDays(t, -d); }
    function ahead(d) { return S.addDays(t, d); }
    var settings = {
      schoolName: 'Patriot Pilot Academy',
      locations: [
        { id: 'kecp', code: 'KECP', name: 'Northwest Florida Beaches — Panama City' },
        { id: 'kcew', code: 'KCEW', name: 'Bob Sikes — Crestview' },
        { id: 'kdhn', code: 'KDHN', name: 'Dothan Regional — Dothan' }
      ],
      types: ['Cessna 172S', 'Cessna 172N', 'Cessna 152', 'Piper PA-28-181 Archer', 'Piper PA-28-161 Warrior', 'Piper PA-44-180 Seminole', 'Diamond DA40'],
      notePresets: ['Back in service today', 'Back in service tomorrow', 'Awaiting parts', 'In the shop', 'Scheduled for inspection', 'Fly with caution — see squawks'],
      groundPresets: ['In for inspection', 'Awaiting parts', 'Damage / repair', 'Paperwork review', 'Other'],
      squawkPresets: ['Landing light inop', 'Tire worn / low', 'Oil leak', 'Radio / intercom issue', 'Fuel gauge inaccurate', 'Brakes soft or pulling', 'Rough engine / mag drop', 'Instrument inop', 'Door / window latch', 'Interior / cosmetic'],
      rules: {},
      tv: { watermark: true, logo: true, pageSeconds: 15, sort: 'status', showSquawkText: true },
      public: { showSquawkText: true },
      updatedAt: new Date().toISOString(),
      lastFspImportAt: ago(10) + 'T12:00:00Z'
    };
    function plane(o) {
      var p = { id: uid(), sample: true, meter: 'tach', ifr: true, forHire: true, na: {}, ads: [], statusNote: '', expectedBack: '', grounded: false, groundedReason: '',
        hoursUpdated: ago(1), fspAircraftId: '', order: 0, updatedAt: new Date().toISOString() };
      p = Object.assign(p, o);
      if (p.tach == null && p.hours != null) p.tach = p.hours;
      if (p.hobbs == null && p.tach != null) p.hobbs = Math.round((Number(p.tach) + 650 + (Number(p.tach) % 80)) * 10) / 10;
      p.tachUpdated = p.tachUpdated || p.hoursUpdated || ago(1);
      p.hobbsUpdated = p.hobbsUpdated || p.hoursUpdated || ago(1);
      p.hours = p.meter === 'hobbs' ? p.hobbs : p.tach;
      p.hoursUpdated = p.meter === 'hobbs' ? p.hobbsUpdated : p.tachUpdated;
      return p;
    }
    var ac = [
      plane({ tail: 'N734PA', type: 'Cessna 172S', location: 'kecp', hours: 4412.6, tach: 4412.6, hobbs: 5120.3, last100: 4361.0, dates: { annual: ago(120), vor: ago(6), pitot: ago(300), xpdr: ago(300), elt: ago(120), eltBattery: ahead(600) },
        ads: [{ id: uid(), number: '2011-10-09', desc: 'Seat rail inspection', intervalHours: 100, lastDoneHours: 4361.0, lastDoneDate: ago(40) }] }),
      plane({ tail: 'N52817', type: 'Cessna 172N', location: 'kecp', hours: 7210.4, last100: 7116.9, dates: { annual: ago(200), vor: ago(12), pitot: ago(400), xpdr: ago(400), elt: ago(200), eltBattery: ahead(300) },
        ads: [{ id: uid(), number: '2011-10-09', desc: 'Seat rail inspection', intervalHours: 100, lastDoneHours: 7116.9 }] }),
      plane({ tail: 'N481PP', type: 'Piper PA-28-181 Archer', location: 'kecp', hours: 3120.2, last100: 3045.0, dates: { annual: ago(380), vor: ago(9), pitot: ago(500), xpdr: ago(500), elt: ago(380), eltBattery: ahead(400) },
        statusNote: '', expectedBack: ahead(3) }),
      plane({ tail: 'N906DS', type: 'Diamond DA40', location: 'kecp', hours: 2286.0, last100: 2231.0, dates: { annual: ago(90), vor: ago(26), pitot: ago(250), xpdr: ago(250), elt: ago(90), eltBattery: ahead(700) } }),
      plane({ tail: 'N3374T', type: 'Piper PA-44-180 Seminole', location: 'kecp', hours: 5530.8, last100: 5490.1, dates: { annual: ago(60), vor: ago(3), pitot: ago(100), xpdr: ago(100), elt: ago(60), eltBattery: ahead(900) },
        ads: [{ id: uid(), number: '2020-03-04', desc: 'Landing gear actuator check', intervalMonths: 12, lastDoneDate: ago(340) }] }),
      plane({ tail: 'N6129K', type: 'Cessna 152', location: 'kecp', hours: 9033.3, last100: 8941.0, ifr: false, dates: { annual: ago(150), pitot: '', vor: '', xpdr: ago(600), elt: ago(150), eltBattery: ahead(200) }, statusNote: 'VFR only' }),
      plane({ tail: 'N217CR', type: 'Cessna 172S', location: 'kcew', hours: 3844.1, last100: 3800.0, dates: { annual: ago(240), vor: ago(14), pitot: ago(200), xpdr: ago(200), elt: ago(240), eltBattery: ahead(19) } }),
      plane({ tail: 'N88412', type: 'Piper PA-28-161 Warrior', location: 'kcew', hours: 6120.7, last100: 6061.0, dates: { annual: ago(30), vor: ago(4), pitot: ago(30), xpdr: ago(30), elt: ago(30), eltBattery: ahead(800) } }),
      plane({ tail: 'N745SW', type: 'Cessna 172S', location: 'kcew', hours: 2977.5, last100: 2901.2, dates: { annual: ago(170), vor: ago(20), pitot: ago(420), xpdr: ago(420), elt: ago(170), eltBattery: ahead(500) } }),
      plane({ tail: 'N19PA', type: 'Piper PA-28-181 Archer', location: 'kcew', hours: 4501.0, last100: 4430.3, dates: { annual: ago(100), vor: ago(8), pitot: ago(380), xpdr: ago(380), elt: ago(100), eltBattery: ahead(620) },
        grounded: true, groundedReason: 'Awaiting parts', statusNote: 'Alternator on order', expectedBack: ahead(5) }),
      plane({ tail: 'N5063D', type: 'Cessna 172N', location: 'kdhn', hours: 8120.0, last100: 8031.0, dates: { annual: ago(210), vor: ago(11), pitot: ago(690), xpdr: ago(690), elt: ago(210), eltBattery: ahead(330) } }),
      plane({ tail: 'N312DH', type: 'Cessna 172S', location: 'kdhn', hours: 1904.3, last100: 1880.0, hoursUpdated: ago(12), dates: { annual: ago(45), vor: ago(2), pitot: ago(45), xpdr: ago(45), elt: ago(45), eltBattery: ahead(1000) } }),
      plane({ tail: 'N4417A', type: 'Piper PA-28-161 Warrior', location: 'kdhn', hours: 5302.2, last100: 5214.0, dates: { annual: ago(330), vor: ago(10), pitot: ago(500), xpdr: ago(500), elt: ago(330), eltBattery: ahead(450) } })
    ];
    ac.forEach(function (a, i) { a.order = i; });
    var sq = [
      { id: uid(), aircraftId: ac[1].id, tail: ac[1].tail, text: 'Landing light inop', severity: 'open', grounding: false, status: 'open', reportedBy: 'Sample CFI', createdAt: ago(2) + 'T15:00:00Z' },
      { id: uid(), aircraftId: ac[8].id, tail: ac[8].tail, text: 'Left brake soft, pulls right on rollout', severity: 'grounding', grounding: true, status: 'open', reportedBy: 'Sample CFI', createdAt: ago(0) + 'T14:20:00Z' },
      { id: uid(), aircraftId: ac[10].id, tail: ac[10].tail, text: 'Intercom static in right seat', severity: 'open', grounding: false, status: 'open', reportedBy: 'Sample CFI', createdAt: ago(5) + 'T13:00:00Z' },
      { id: uid(), aircraftId: ac[10].id, tail: ac[10].tail, text: 'Seat cushion torn', severity: 'info', grounding: false, status: 'open', reportedBy: 'Sample CFI', createdAt: ago(9) + 'T13:00:00Z' }
    ];
    var flightReports = [
      { id: uid(), aircraftId: ac[0].id, tail: ac[0].tail, reporterEmail: 'cfi@example.com', reportedBy: 'Sample CFI', student: 'Alex Student',
        oilAdded: true, oilQts: 1.5, tachStart: 4404.2, tachEnd: 4411.4, hobbsStart: 5112.0, hobbsEnd: 5119.6,
        createdAt: ago(2) + 'T18:00:00Z', applied: false },
      { id: uid(), aircraftId: ac[0].id, tail: ac[0].tail, reporterEmail: 'cfi@example.com', reportedBy: 'Sample CFI', student: 'Jordan Lee',
        oilAdded: true, oilQts: 1, tachStart: 4396.8, tachEnd: 4404.2, hobbsStart: 5104.1, hobbsEnd: 5112.0,
        createdAt: ago(8) + 'T16:30:00Z', applied: false },
      { id: uid(), aircraftId: ac[0].id, tail: ac[0].tail, reporterEmail: 'cfi@example.com', reportedBy: 'Sample CFI', student: '',
        oilAdded: true, oilQts: 2, tachStart: 4370.0, tachEnd: 4378.5, hobbsStart: 5076.0, hobbsEnd: 5084.2,
        createdAt: ago(40) + 'T15:00:00Z', applied: false },
      { id: uid(), aircraftId: ac[6].id, tail: ac[6].tail, reporterEmail: 'cfi@example.com', reportedBy: 'Sample CFI', student: 'Sam Patel',
        oilAdded: true, oilQts: 1, tachStart: 3838.0, tachEnd: 3843.5, hobbsStart: 4480.0, hobbsEnd: 4486.1,
        createdAt: ago(5) + 'T14:00:00Z', applied: false }
    ];
    var alerts = { enabled: false, onGrounded: true, onDueSoon: true, onReturn: true, digest: false, digestHour: 7,
      recipients: [
        { id: uid(), name: 'Sample Mechanic', email: 'mechanic@example.com', group: 'Mechanic', locations: [], active: true },
        { id: uid(), name: 'Sample CFI (KECP)', email: 'cfi@example.com', group: 'CFI', locations: ['kecp'], active: true }
      ] };
    var priv = {}; priv[ac[9].id] = { internalNote: 'SAMPLE internal note: alternator P/N ordered from vendor, ETA 3 days. Do not show customers.' };
    return { settings: settings, aircraft: ac, squawks: sq, closedSquawks: [], flightReports: flightReports, alerts: alerts, priv: priv,
      roles: [{ email: 'owner@example.com', role: 'editor', name: 'Sample Owner' }, { email: 'cfi@example.com', role: 'cfi', name: 'Sample CFI' }],
      accessRequests: [
        { email: 'jordan@example.com', name: 'Jordan Lee', requestedAt: ago(1) + 'T18:10:00Z', status: 'pending' },
        { email: 'sam.cfi@example.com', name: 'Sam Rivera', requestedAt: ago(2) + 'T12:00:00Z', status: 'pending' }
      ] };
  }
  return { build: build, uid: uid };
})();
