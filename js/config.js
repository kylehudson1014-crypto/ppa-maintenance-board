/* ===== PPA Maintenance Board — live data connection =====
   Leave firebaseConfig = null to run in DEMO mode (sample data saved on this device only).
   To go live: paste the config object from Firebase console > Project settings > Your apps > Web app.
   This is NOT a secret; security comes from the Firestore rules. */
window.PPA_CONFIG = {
  firebaseConfig: {
    apiKey: "AIzaSyAFOel6UVhYbKH8k2votOx6w84Qhn0V7zw",
    authDomain: "ppa-maintence-board.firebaseapp.com",
    projectId: "ppa-maintence-board",
    storageBucket: "ppa-maintence-board.firebasestorage.app",
    messagingSenderId: "914839932716",
    appId: "1:914839932716:web:9d7b3ffee22a69607f2689"
  },
  setupDocUrl: 'https://docs.google.com/document/d/1S805Zv7ZyJvhm5MF_tJmQg8SNcFF4NTFdd2DrboUGEk/edit'
};
