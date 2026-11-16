import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc, addDoc, collection, updateDoc, deleteDoc, getDocs, query, where } from 'firebase/firestore';
const env = await initializeTestEnvironment({ projectId: 'ppa-mb-test', firestore: { rules: readFileSync(process.argv[2], 'utf8'), host: '127.0.0.1', port: 8089 } });
await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, 'roles/owner@x.com'), { role: 'editor' });
  await setDoc(doc(db, 'roles/cfi@x.com'), { role: 'cfi' });
  await setDoc(doc(db, 'roles/bot@x.com'), { role: 'alerts' });
  await setDoc(doc(db, 'aircraft/a1'), { tail: 'N1' });
  await setDoc(doc(db, 'aircraftPrivate/a1'), { internalNote: 'secret' });
  await setDoc(doc(db, 'config/public'), { locations: [] });
  await setDoc(doc(db, 'config/alerts'), { recipients: [{ email: 'x@y.com' }] });
  await setDoc(doc(db, 'squawks/s1'), { aircraftId: 'a1', status: 'open', text: 't' });
});
const pub = env.unauthenticatedContext().firestore();
const owner = env.authenticatedContext('u1', { email: 'owner@x.com' }).firestore();
const cfi = env.authenticatedContext('u2', { email: 'cfi@x.com' }).firestore();
const bot = env.authenticatedContext('u3', { email: 'bot@x.com' }).firestore();
const stranger = env.authenticatedContext('u4', { email: 'nobody@x.com' }).firestore();
const sq = (o = {}) => Object.assign({ aircraftId: 'a1', tail: 'N1', text: 'Oil leak', severity: 'open', grounding: false, status: 'open', reportedBy: 'CFI', createdAt: new Date().toISOString() }, o);
let pass = 0, fail = 0;
async function t(name, p) { try { await p; pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, e.message); } }
await t('public reads aircraft', assertSucceeds(getDoc(doc(pub, 'aircraft/a1'))));
await t('public reads config/public', assertSucceeds(getDoc(doc(pub, 'config/public'))));
await t('public reads open squawks', assertSucceeds(getDocs(query(collection(pub, 'squawks'), where('status', '==', 'open')))));
await t('public CANNOT read private notes', assertFails(getDoc(doc(pub, 'aircraftPrivate/a1'))));
await t('public CANNOT read alert recipients', assertFails(getDoc(doc(pub, 'config/alerts'))));
await t('public CANNOT read roles', assertFails(getDoc(doc(pub, 'roles/owner@x.com'))));
await t('public CANNOT write aircraft', assertFails(setDoc(doc(pub, 'aircraft/a1'), { tail: 'X' })));
await t('public CANNOT create squawk', assertFails(addDoc(collection(pub, 'squawks'), sq())));
await t('stranger (no role) CANNOT create squawk', assertFails(addDoc(collection(stranger, 'squawks'), sq())));
await t('stranger CANNOT read private', assertFails(getDoc(doc(stranger, 'aircraftPrivate/a1'))));
await t('CFI creates squawk', assertSucceeds(addDoc(collection(cfi, 'squawks'), sq())));
await t('CFI creates grounding squawk', assertSucceeds(addDoc(collection(cfi, 'squawks'), sq({ severity: 'grounding', grounding: true }))));
await t('CFI CANNOT create closed squawk', assertFails(addDoc(collection(cfi, 'squawks'), sq({ status: 'closed' }))));
await t('CFI CANNOT fake grounding flag', assertFails(addDoc(collection(cfi, 'squawks'), sq({ severity: 'grounding', grounding: false }))));
await t('CFI CANNOT add extra fields', assertFails(addDoc(collection(cfi, 'squawks'), sq({ hack: 1 }))));
await t('CFI CANNOT squawk unknown aircraft', assertFails(addDoc(collection(cfi, 'squawks'), sq({ aircraftId: 'nope' }))));
await t('CFI CANNOT close squawk', assertFails(updateDoc(doc(cfi, 'squawks/s1'), { status: 'closed' })));
await t('CFI CANNOT edit aircraft', assertFails(setDoc(doc(cfi, 'aircraft/a1'), { tail: 'X' })));
await t('CFI CANNOT read private', assertFails(getDoc(doc(cfi, 'aircraftPrivate/a1'))));
await t('CFI reads own role', assertSucceeds(getDoc(doc(cfi, 'roles/cfi@x.com'))));
await t('CFI CANNOT promote self', assertFails(setDoc(doc(cfi, 'roles/cfi@x.com'), { role: 'editor' })));
await t('CFI CANNOT read others roles', assertFails(getDoc(doc(cfi, 'roles/owner@x.com'))));
await t('editor writes aircraft', assertSucceeds(setDoc(doc(owner, 'aircraft/a2'), { tail: 'N2' })));
await t('editor reads/writes private', assertSucceeds(setDoc(doc(owner, 'aircraftPrivate/a1'), { internalNote: 'x' })));
await t('editor closes squawk', assertSucceeds(updateDoc(doc(owner, 'squawks/s1'), { status: 'closed' })));
await t('editor writes settings', assertSucceeds(setDoc(doc(owner, 'config/public'), { locations: [{ code: 'KECP' }] })));
await t('editor writes alerts', assertSucceeds(setDoc(doc(owner, 'config/alerts'), { enabled: false })));
await t('editor manages roles', assertSucceeds(setDoc(doc(owner, 'roles/new@x.com'), { role: 'cfi' })));
await t('editor deletes aircraft', assertSucceeds(deleteDoc(doc(owner, 'aircraft/a2'))));
await t('alerts bot reads alerts config', assertSucceeds(getDoc(doc(bot, 'config/alerts'))));
await t('alerts bot CANNOT write alerts', assertFails(setDoc(doc(bot, 'config/alerts'), { enabled: true })));
await t('alerts bot CANNOT write aircraft', assertFails(setDoc(doc(bot, 'aircraft/a1'), { tail: 'X' })));
await t('unknown collection blocked', assertFails(setDoc(doc(owner, 'junk/x'), { a: 1 })));

const fr = (o = {}) => Object.assign({
  aircraftId: 'a1', tail: 'N1', reporterEmail: 'cfi@x.com', reportedBy: 'Pat CFI', student: 'Alex Student',
  oilAdded: true, oilQts: 1.5, tachStart: 100, tachEnd: 101.2, hobbsStart: 200, hobbsEnd: 201.4,
  createdAt: new Date().toISOString(), applied: false
}, o);
await t('public CANNOT read flightReports', assertFails(getDocs(collection(pub, 'flightReports'))));
await t('public CANNOT create flightReport', assertFails(addDoc(collection(pub, 'flightReports'), fr())));
await t('stranger CANNOT create flightReport', assertFails(addDoc(collection(stranger, 'flightReports'), fr({ reporterEmail: 'nobody@x.com' }))));
await t('CFI creates valid flightReport', assertSucceeds(addDoc(collection(cfi, 'flightReports'), fr())));
await t('CFI creates oil-only flightReport', assertSucceeds(addDoc(collection(cfi, 'flightReports'), fr({ oilAdded: false, oilQts: null, tachStart: null, tachEnd: null, hobbsStart: null, hobbsEnd: null }))));
await t('CFI creates report with blank student', assertSucceeds(addDoc(collection(cfi, 'flightReports'), fr({ student: '' }))));
await t('CFI CANNOT set student over 80 chars', assertFails(addDoc(collection(cfi, 'flightReports'), fr({ student: 'x'.repeat(81) }))));
await t('CFI CANNOT omit student field', assertFails(addDoc(collection(cfi, 'flightReports'), (({student, ...o}) => o)(fr()))));
await t('CFI CANNOT create applied report', assertFails(addDoc(collection(cfi, 'flightReports'), fr({ applied: true }))));
await t('CFI CANNOT add extra fields to report', assertFails(addDoc(collection(cfi, 'flightReports'), fr({ hack: 1 }))));
await t('CFI CANNOT spoof reporter email', assertFails(addDoc(collection(cfi, 'flightReports'), fr({ reporterEmail: 'owner@x.com' }))));
await t('CFI CANNOT report unknown aircraft', assertFails(addDoc(collection(cfi, 'flightReports'), fr({ aircraftId: 'nope' }))));
await t('CFI CANNOT set end before start', assertFails(addDoc(collection(cfi, 'flightReports'), fr({ tachEnd: 90 }))));
await t('CFI CANNOT set invalid oil quarts', assertFails(addDoc(collection(cfi, 'flightReports'), fr({ oilQts: 9 }))));
await t('CFI CANNOT read flightReports', assertFails(getDocs(collection(cfi, 'flightReports'))));

await env.withSecurityRulesDisabled(async (c) => {
  await setDoc(doc(c.firestore(), 'flightReports/r1'), fr({ reportedBy: 'Seed' }));
});
await t('CFI CANNOT apply a report', assertFails(updateDoc(doc(cfi, 'flightReports/r1'), { applied: true })));
await t('CFI CANNOT delete a report', assertFails(deleteDoc(doc(cfi, 'flightReports/r1'))));
await t('editor reads flightReports', assertSucceeds(getDoc(doc(owner, 'flightReports/r1'))));
await t('editor applies flightReport', assertSucceeds(updateDoc(doc(owner, 'flightReports/r1'), { applied: true })));
await t('editor deletes flightReport', assertSucceeds(deleteDoc(doc(owner, 'flightReports/r1'))));
await t('editor creates flightReport', assertSucceeds(addDoc(collection(owner, 'flightReports'), fr({ reporterEmail: 'owner@x.com', reportedBy: 'Owner' }))));


const ar = (o = {}) => Object.assign({
  name: 'Jordan Lee', email: 'nobody@x.com', requestedAt: new Date().toISOString(), status: 'pending'
}, o);
await t('public CANNOT read accessRequests', assertFails(getDocs(collection(pub, 'accessRequests'))));
await t('public CANNOT create accessRequest', assertFails(setDoc(doc(pub, 'accessRequests/nobody@x.com'), ar())));
await t('stranger CANNOT create request under another email', assertFails(setDoc(doc(stranger, 'accessRequests/cfi@x.com'), ar({ email: 'cfi@x.com' }))));
await t('stranger CANNOT spoof email field', assertFails(setDoc(doc(stranger, 'accessRequests/nobody@x.com'), ar({ email: 'owner@x.com' }))));
await t('stranger CANNOT create already-approved request', assertFails(setDoc(doc(stranger, 'accessRequests/nobody@x.com'), ar({ status: 'approved' }))));
await t('stranger CANNOT add extra fields to request', assertFails(setDoc(doc(stranger, 'accessRequests/nobody@x.com'), ar({ hack: 1 }))));
await t('stranger CANNOT use an empty name', assertFails(setDoc(doc(stranger, 'accessRequests/nobody@x.com'), ar({ name: '' }))));
await t('stranger creates own pending accessRequest', assertSucceeds(setDoc(doc(stranger, 'accessRequests/nobody@x.com'), ar())));
await t('stranger reads own accessRequest', assertSucceeds(getDoc(doc(stranger, 'accessRequests/nobody@x.com'))));
await t('stranger CANNOT list all accessRequests', assertFails(getDocs(collection(stranger, 'accessRequests'))));
await t('stranger CANNOT update own request', assertFails(updateDoc(doc(stranger, 'accessRequests/nobody@x.com'), { status: 'approved' })));
await t('stranger CANNOT write their own role', assertFails(setDoc(doc(stranger, 'roles/nobody@x.com'), { role: 'cfi', name: 'Jordan Lee' })));
await t('CFI CANNOT read someone else\'s accessRequest', assertFails(getDoc(doc(cfi, 'accessRequests/nobody@x.com'))));
await t('editor lists accessRequests', assertSucceeds(getDocs(collection(owner, 'accessRequests'))));
await t('editor reads a request', assertSucceeds(getDoc(doc(owner, 'accessRequests/nobody@x.com'))));
await t('editor approves a request', assertSucceeds(updateDoc(doc(owner, 'accessRequests/nobody@x.com'), { status: 'approved', approvedRole: 'cfi', reviewedAt: new Date().toISOString(), reviewedBy: 'owner@x.com' })));
await t('editor can deny a request', assertSucceeds(updateDoc(doc(owner, 'accessRequests/nobody@x.com'), { status: 'denied', reviewedAt: new Date().toISOString(), reviewedBy: 'owner@x.com' })));
await t('editor CANNOT change the request email', assertFails(updateDoc(doc(owner, 'accessRequests/nobody@x.com'), { email: 'other@x.com', status: 'denied' })));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup(); process.exit(fail ? 1 : 0);
