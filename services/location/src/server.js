require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const { randomBytes, scrypt, timingSafeEqual } = require('crypto');
const { promisify } = require('util');
const scryptAsync = promisify(scrypt);
const JWT_SECRET = process.env.JWT_SECRET || 'accessroute-local-development-secret-change-before-deploying';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') || true }));
app.use(express.json({ limit: '100kb' }));
const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017', { serverSelectionTimeoutMS: 5000 });
let locations, paths, accounts;

const seedLocations = [
  { _id: 'north-gate', name: 'North Gate', type: 'entrance', description: 'Main campus entrance', x: 11, y: 48, accessible: true },
  { _id: 'student-center', name: 'Student Center', type: 'building', description: 'Student services & café', x: 36, y: 31, accessible: true },
  { _id: 'library', name: 'Central Library', type: 'building', description: 'Library and learning commons', x: 64, y: 27, accessible: true },
  { _id: 'science-hall', name: 'Science Hall', type: 'building', description: 'Science laboratories', x: 78, y: 59, accessible: true },
  { _id: 'east-gate', name: 'East Gate', type: 'entrance', description: 'Accessible east entrance', x: 93, y: 49, accessible: true },
  { _id: 'arts-block', name: 'Arts Block', type: 'building', description: 'Studios and lecture rooms', x: 47, y: 74, accessible: true },
  { _id: 'quad', name: 'Main Quad', type: 'landmark', description: 'Central courtyard', x: 49, y: 49, accessible: true },
  { _id: 'wellness', name: 'Wellness Centre', type: 'building', description: 'Health and wellbeing', x: 23, y: 72, accessible: true }
];
const seedPaths = [
  { _id: 'p1', from: 'north-gate', to: 'student-center', distance: 180, surface: 'paved', stairs: false, ramp: true, elevator: false, blocked: false, label: 'North Walk' },
  { _id: 'p2', from: 'student-center', to: 'library', distance: 145, surface: 'paved', stairs: false, ramp: false, elevator: false, blocked: false, label: 'Library Lane' },
  { _id: 'p3', from: 'library', to: 'science-hall', distance: 230, surface: 'paved', stairs: false, ramp: true, elevator: false, blocked: false, label: 'East Garden Path' },
  { _id: 'p4', from: 'science-hall', to: 'east-gate', distance: 160, surface: 'paved', stairs: false, ramp: false, elevator: false, blocked: false, label: 'East Walk' },
  { _id: 'p5', from: 'student-center', to: 'quad', distance: 120, surface: 'paved', stairs: false, ramp: false, elevator: false, blocked: false, label: 'Quad Promenade' },
  { _id: 'p6', from: 'quad', to: 'library', distance: 115, surface: 'paved', stairs: false, ramp: true, elevator: false, blocked: false, label: 'Garden Walk' },
  { _id: 'p7', from: 'quad', to: 'arts-block', distance: 170, surface: 'paved', stairs: false, ramp: true, elevator: false, blocked: false, label: 'Arts Walk' },
  { _id: 'p8', from: 'arts-block', to: 'wellness', distance: 190, surface: 'paved', stairs: false, ramp: false, elevator: false, blocked: false, label: 'South Garden Path' },
  { _id: 'p9', from: 'wellness', to: 'north-gate', distance: 250, surface: 'paved', stairs: false, ramp: true, elevator: false, blocked: false, label: 'West Walk' },
  { _id: 'p10', from: 'quad', to: 'science-hall', distance: 210, surface: 'paved', stairs: true, ramp: false, elevator: false, blocked: false, label: 'Amphitheatre Steps' },
  { _id: 'p11', from: 'student-center', to: 'arts-block', distance: 205, surface: 'paved', stairs: false, ramp: true, elevator: false, blocked: true, label: 'South Connector · maintenance' },
  { _id: 'p12', from: 'library', to: 'arts-block', distance: 220, surface: 'paved', stairs: false, ramp: false, elevator: true, blocked: false, label: 'Library Lift Link' }
];
async function connect() {
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'accessroute');
  locations = db.collection('locations'); paths = db.collection('paths'); accounts = db.collection('student_accounts');
  await locations.createIndex({ name: 1 });
  await accounts.createIndex({ email: 1 }, { unique: true });
  if (await locations.countDocuments() === 0) await locations.insertMany(seedLocations);
  if (await paths.countDocuments() === 0) await paths.insertMany(seedPaths);
  console.log('Connected to MongoDB; campus graph ready.');
}
const publicDoc = doc => { if (!doc) return doc; const { _id, ...rest } = doc; return { id: String(_id), ...rest }; };
const isId = id => typeof id === 'string' && /^[\w-]{1,80}$/.test(id);
const dbId = id => ObjectId.isValid(id) && String(new ObjectId(id)) === id.toLowerCase() ? new ObjectId(id) : id;
const cleanLocation = body => ({ name: String(body.name || '').trim(), type: body.type || 'building', description: String(body.description || '').trim(), x: Number(body.x), y: Number(body.y), accessible: body.accessible !== false });
const cleanPath = body => ({ from: String(body.from || ''), to: String(body.to || ''), distance: Number(body.distance), surface: body.surface || 'paved', stairs: Boolean(body.stairs), ramp: Boolean(body.ramp), elevator: Boolean(body.elevator), blocked: Boolean(body.blocked), label: String(body.label || '').trim() });
const validLocation = p => p.name && ['building','entrance','landmark'].includes(p.type) && Number.isFinite(p.x) && p.x >= 0 && p.x <= 100 && Number.isFinite(p.y) && p.y >= 0 && p.y <= 100;
const validPath = p => isId(p.from) && isId(p.to) && p.from !== p.to && Number.isFinite(p.distance) && p.distance > 0 && p.distance <= 10000 && p.label;
const safeUser = account => ({ id: String(account._id), name: account.name, email: account.email, studentId: account.studentId || '', role: 'student' });
async function passwordHash(password, salt = randomBytes(16).toString('hex')) { const key = await scryptAsync(password, salt, 64); return { salt, hash: Buffer.from(key).toString('hex') }; }
function createToken(account) { return jwt.sign({ sub: String(account._id), role: 'student' }, JWT_SECRET, { expiresIn: '12h' }); }

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const studentId = String(req.body.studentId || '').trim().slice(0, 40);
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Enter your name (2–80 characters).' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Use a password between 8 and 128 characters.' });
    const credential = await passwordHash(password);
    const account = { name, email, studentId, passwordSalt: credential.salt, passwordHash: credential.hash, createdAt: new Date() };
    const result = await accounts.insertOne(account);
    const created = { ...account, _id: result.insertedId };
    res.status(201).json({ token: createToken(created), user: safeUser(created) });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
    next(e);
  }
});
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const account = await accounts.findOne({ email });
    if (!account || !account.passwordSalt || !account.passwordHash) return res.status(401).json({ error: 'Email or password is incorrect.' });
    const derived = Buffer.from(await scryptAsync(password, account.passwordSalt, 64));
    const expected = Buffer.from(account.passwordHash, 'hex');
    if (derived.length !== expected.length || !timingSafeEqual(derived, expected)) return res.status(401).json({ error: 'Email or password is incorrect.' });
    res.json({ token: createToken(account), user: safeUser(account) });
  } catch (e) { next(e); }
});
app.get('/api/auth/me', async (req, res) => {
  try {
    const header = req.get('authorization') || '';
    if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Sign in to continue.' });
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    if (payload.role !== 'student' || !ObjectId.isValid(payload.sub)) return res.status(401).json({ error: 'Your session is invalid. Sign in again.' });
    const account = await accounts.findOne({ _id: new ObjectId(payload.sub) });
    if (!account) return res.status(401).json({ error: 'Your account is no longer available.' });
    res.json({ user: safeUser(account) });
  } catch { res.status(401).json({ error: 'Your session has expired. Sign in again.' }); }
});

app.get('/api/health', async (_req, res) => {
  try { await client.db('admin').command({ ping: 1 }); res.json({ status: 'ok', service: 'campus-location', database: 'connected' }); }
  catch { res.status(503).json({ status: 'degraded', service: 'campus-location', database: 'unavailable' }); }
});
app.get('/api/locations', async (_req, res, next) => { try { res.json((await locations.find().toArray()).map(publicDoc)); } catch (e) { next(e); } });
app.post('/api/locations', async (req, res, next) => { try { const item = cleanLocation(req.body); if (!validLocation(item)) return res.status(400).json({ error: 'Provide a name, valid type, and map coordinates from 0 to 100.' }); const result = await locations.insertOne(item); res.status(201).json(publicDoc({ ...item, _id: result.insertedId })); } catch (e) { next(e); } });
app.get('/api/locations/:id', async (req, res, next) => { try { const item = await locations.findOne({ _id: dbId(req.params.id) }); if (!item) return res.status(404).json({ error: 'Location not found.' }); res.json(publicDoc(item)); } catch (e) { next(e); } });
app.put('/api/locations/:id', async (req, res, next) => { try { const item = cleanLocation(req.body); if (!validLocation(item)) return res.status(400).json({ error: 'Invalid location fields.' }); const result = await locations.findOneAndUpdate({ _id: dbId(req.params.id) }, { $set: item }, { returnDocument: 'after' }); if (!result) return res.status(404).json({ error: 'Location not found.' }); res.json(publicDoc(result)); } catch (e) { next(e); } });
app.delete('/api/locations/:id', async (req, res, next) => { try { const result = await locations.deleteOne({ _id: dbId(req.params.id) }); if (!result.deletedCount) return res.status(404).json({ error: 'Location not found.' }); await paths.deleteMany({ $or: [{ from: req.params.id }, { to: req.params.id }] }); res.status(204).end(); } catch (e) { next(e); } });
app.get('/api/paths', async (req, res, next) => { try { const query = req.query.includeBlocked === 'true' ? {} : { blocked: { $ne: true } }; res.json((await paths.find(query).toArray()).map(publicDoc)); } catch (e) { next(e); } });
app.post('/api/paths', async (req, res, next) => { try { const item = cleanPath(req.body); if (!validPath(item)) return res.status(400).json({ error: 'Provide valid endpoints, positive distance, and a pathway label.' }); const [a,b] = await Promise.all([locations.findOne({ _id: dbId(item.from) }), locations.findOne({ _id: dbId(item.to) })]); if (!a || !b) return res.status(400).json({ error: 'Both pathway endpoints must exist.' }); const result = await paths.insertOne(item); res.status(201).json(publicDoc({ ...item, _id: result.insertedId })); } catch (e) { next(e); } });
app.put('/api/paths/:id', async (req, res, next) => { try { const item = cleanPath(req.body); if (!validPath(item)) return res.status(400).json({ error: 'Invalid pathway fields.' }); const [a,b] = await Promise.all([locations.findOne({ _id: dbId(item.from) }), locations.findOne({ _id: dbId(item.to) })]); if (!a || !b) return res.status(400).json({ error: 'Both pathway endpoints must exist.' }); const result = await paths.findOneAndUpdate({ _id: dbId(req.params.id) }, { $set: item }, { returnDocument: 'after' }); if (!result) return res.status(404).json({ error: 'Pathway not found.' }); res.json(publicDoc(result)); } catch (e) { next(e); } });
app.delete('/api/paths/:id', async (req, res, next) => { try { const result = await paths.deleteOne({ _id: dbId(req.params.id) }); if (!result.deletedCount) return res.status(404).json({ error: 'Pathway not found.' }); res.status(204).end(); } catch (e) { next(e); } });
app.get('/api/graph', async (_req, res, next) => { try { const [nodes, edges] = await Promise.all([locations.find().toArray(), paths.find({ blocked: { $ne: true } }).toArray()]); res.json({ locations: nodes.map(publicDoc), paths: edges.map(publicDoc), generatedAt: new Date().toISOString() }); } catch (e) { next(e); } });
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Location service could not complete the request.' }); });
const port = Number(process.env.PORT) || 4001;
connect().then(() => app.listen(port, '0.0.0.0', () => console.log(`Location service listening on ${port}`))).catch(err => { console.error('MongoDB connection failed:', err.message); process.exit(1); });
