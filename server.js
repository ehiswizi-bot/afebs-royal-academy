const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const db = new Database(path.join(__dirname, 'afebs.db'));
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(session({ secret: process.env.SESSION_SECRET || 'CHANGE_THIS_LONG_RANDOM_SECRET_BEFORE_DEPLOYMENT', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 1000 * 60 * 60 * 8 } }));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));

// A single-school starter schema. Add a school_id tenant boundary to every table before SaaS rollout.
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('director','teacher','parent','student','administrator','bursar')), status TEXT NOT NULL DEFAULT 'active', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, admission_no TEXT NOT NULL UNIQUE, class_name TEXT NOT NULL, parent_user_id INTEGER, status TEXT NOT NULL DEFAULT 'active', created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(parent_user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS announcements (id INTEGER PRIMARY KEY, title TEXT NOT NULL, message TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'General', audience TEXT NOT NULL DEFAULT 'Everyone', priority TEXT NOT NULL DEFAULT 'Normal', publish_at TEXT DEFAULT CURRENT_TIMESTAMP, created_by INTEGER, archived INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(created_by) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, attendance_date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('Present','Absent','Late','Excused')), marked_by INTEGER, UNIQUE(student_id, attendance_date), FOREIGN KEY(student_id) REFERENCES students(id), FOREIGN KEY(marked_by) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY, actor_id INTEGER, action TEXT NOT NULL, record_type TEXT NOT NULL, record_id INTEGER, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(actor_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY, email TEXT NOT NULL, success INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

function logAction(actor, action, type, id, details='') {
  db.prepare('INSERT INTO audit_logs(actor_id, action, record_type, record_id, details) VALUES(?,?,?,?,?)').run(actor?.id || null, action, type, id || null, details);
}
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please sign in.' });
  const user = db.prepare('SELECT id,name,email,role,status FROM users WHERE id=?').get(req.session.userId);
  if (!user || user.status !== 'active') { req.session.destroy(() => {}); return res.status(403).json({ error: 'This account is inactive.' }); }
  req.user = user; next();
}
function allow(...roles) { return (req,res,next) => { if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({error:'You do not have permission to perform this action.'}); next(); }; }
function seed() {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n) return;
  const pass = bcrypt.hashSync(process.env.DEMO_PASSWORD || 'ChangeMe123!', 12);
  const add = db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)');
  add.run('AFEBS Director','director@afebs.demo',pass,'director');
  add.run('Jane Okafor','teacher@afebs.demo',pass,'teacher');
  add.run('Mary Eze','parent@afebs.demo',pass,'parent');
  add.run('David Eze','student@afebs.demo',pass,'student');
  add.run('School Bursar','bursar@afebs.demo',pass,'bursar');
  const parent = db.prepare("SELECT id FROM users WHERE role='parent'").get().id;
  const student = db.prepare('INSERT INTO students(full_name,admission_no,class_name,parent_user_id) VALUES(?,?,?,?)');
  const classes=['Nursery 1','Nursery 2','Basic 1','Basic 2','Basic 3','Basic 4','Basic 5','Basic 6'];
  for(let i=1;i<=24;i++) student.run(['David Eze','Amara Okafor','Daniel Ojo','Faith Osagie','Samuel Bello','Esther Aigbe'][i%6],`AFRA/${String(i).padStart(4,'0')}`,classes[(i-1)%classes.length],i===1?parent:null);
  db.prepare('INSERT INTO announcements(title,message,category,audience,priority,created_by) VALUES(?,?,?,?,?,?)').run('Welcome to AFEBS Royal Academy','Welcome to the school management portal. Check this space for important school updates.','General','Everyone','Important',1);
}
seed();
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/login', (req,res) => {
  const email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'');
  const user=db.prepare('SELECT * FROM users WHERE lower(email)=?').get(email);
  const ok=!!user && bcrypt.compareSync(password,user.password_hash) && user.status==='active';
  db.prepare('INSERT INTO login_attempts(email,success) VALUES(?,?)').run(email,ok?1:0);
  if(!ok) return res.status(401).json({error:'Email or password is incorrect, or the account is inactive.'});
  req.session.userId=user.id; logAction({id:user.id},'Login','User',user.id); res.json({id:user.id,name:user.name,email:user.email,role:user.role});
});
app.post('/api/auth/logout', requireAuth, (req,res)=>{ logAction(req.user,'Logout','User',req.user.id); req.session.destroy(()=>res.json({ok:true})); });
app.get('/api/auth/me', requireAuth, (req,res)=>res.json(req.user));

app.get('/api/dashboard', requireAuth, (req,res)=>{
  const role=req.user.role;
  const data={user:req.user, students:0,teachers:0,parents:0,classes:8,activeUsers:db.prepare("SELECT COUNT(*) n FROM users WHERE status='active'").get().n, announcements:[], recentActivity:[]};
  if(['director','administrator','bursar'].includes(role)) {
    data.students=db.prepare("SELECT COUNT(*) n FROM students WHERE status='active'").get().n;
    data.teachers=db.prepare("SELECT COUNT(*) n FROM users WHERE role='teacher' AND status='active'").get().n;
    data.parents=db.prepare("SELECT COUNT(*) n FROM users WHERE role='parent' AND status='active'").get().n;
    data.recentActivity=db.prepare('SELECT a.action,a.record_type,a.details,a.created_at,u.name FROM audit_logs a LEFT JOIN users u ON a.actor_id=u.id ORDER BY a.id DESC LIMIT 8').all();
  } else if(role==='parent') data.children=db.prepare('SELECT id,full_name,admission_no,class_name FROM students WHERE parent_user_id=?').all(req.user.id);
  else if(role==='student') data.student=db.prepare('SELECT id,full_name,admission_no,class_name FROM students WHERE id=?').get(req.user.id);
  data.announcements=db.prepare("SELECT id,title,message,category,audience,priority,publish_at FROM announcements WHERE archived=0 AND (audience='Everyone' OR audience=?) ORDER BY id DESC LIMIT 10").all(role==='teacher'?'Teachers':role==='parent'?'Parents':role==='student'?'Students':'Everyone');
  res.json(data);
});

app.get('/api/students', requireAuth, (req,res)=>{
  if(req.user.role==='parent') return res.json(db.prepare('SELECT id,full_name,admission_no,class_name,status FROM students WHERE parent_user_id=? ORDER BY full_name').all(req.user.id));
  if(!['director','administrator','teacher','bursar'].includes(req.user.role)) return res.status(403).json({error:'Not permitted.'});
  res.json(db.prepare('SELECT id,full_name,admission_no,class_name,status FROM students ORDER BY id DESC').all());
});
app.post('/api/students', requireAuth, allow('director','administrator'), (req,res)=>{
  const {full_name,admission_no,class_name}=req.body;
  if(!full_name||!admission_no||!class_name) return res.status(400).json({error:'Full name, admission number and class are required.'});
  try { const r=db.prepare('INSERT INTO students(full_name,admission_no,class_name) VALUES(?,?,?)').run(full_name.trim(),admission_no.trim(),class_name); logAction(req.user,'Student registered','Student',r.lastInsertRowid,full_name); res.status(201).json({id:r.lastInsertRowid}); }
  catch(e){ res.status(400).json({error:e.message.includes('UNIQUE')?'Admission number already exists.':'Could not create student.'}); }
});
app.patch('/api/users/:id/status', requireAuth, allow('director'), (req,res)=>{
  const status=req.body.status; if(!['active','suspended','inactive'].includes(status)) return res.status(400).json({error:'Invalid status.'});
  const target=db.prepare('SELECT id,role FROM users WHERE id=?').get(req.params.id); if(!target) return res.status(404).json({error:'User not found.'});
  if(target.role==='director') return res.status(400).json({error:'The Director account cannot be suspended through this endpoint.'});
  db.prepare('UPDATE users SET status=? WHERE id=?').run(status,target.id); logAction(req.user,'Account status changed','User',target.id,status); res.json({ok:true});
});
app.get('/api/announcements', requireAuth, (req,res)=>res.json(db.prepare('SELECT id,title,message,category,audience,priority,publish_at FROM announcements WHERE archived=0 ORDER BY id DESC').all()));
app.post('/api/announcements', requireAuth, allow('director','administrator'), (req,res)=>{
  const {title,message,category='General',audience='Everyone',priority='Normal'}=req.body;
  const categories=['General','Academic','Finance','Examination','Events','Emergency','Important Notice'];
  const audiences=['Everyone','Teachers','Parents','Students']; const priorities=['Low','Normal','Important','High','Critical'];
  if(!title?.trim()||!message?.trim()) return res.status(400).json({error:'Title and message are required.'});
  if(!categories.includes(category)||!audiences.includes(audience)||!priorities.includes(priority)) return res.status(400).json({error:'Invalid category, audience or priority.'});
  const r=db.prepare('INSERT INTO announcements(title,message,category,audience,priority,created_by) VALUES(?,?,?,?,?,?)').run(title.trim(),message.trim(),category,audience,priority,req.user.id);
  logAction(req.user,'Announcement published','Announcement',r.lastInsertRowid,title.trim()); res.status(201).json({id:r.lastInsertRowid});
});
app.delete('/api/announcements/:id', requireAuth, allow('director'), (req,res)=>{ const r=db.prepare('UPDATE announcements SET archived=1 WHERE id=?').run(req.params.id); if(!r.changes) return res.status(404).json({error:'Announcement not found.'}); logAction(req.user,'Announcement archived','Announcement',req.params.id); res.json({ok:true}); });
app.get('/api/activity', requireAuth, allow('director','administrator'), (req,res)=>res.json(db.prepare('SELECT a.id,a.action,a.record_type,a.record_id,a.details,a.created_at,u.name FROM audit_logs a LEFT JOIN users u ON a.actor_id=u.id ORDER BY a.id DESC LIMIT 100').all()));
app.get('/api/users', requireAuth, allow('director','administrator'), (req,res)=>res.json(db.prepare('SELECT id,name,email,role,status,created_at FROM users ORDER BY id').all()));
app.get('/api/security/attempts', requireAuth, allow('director'), (req,res)=>res.json(db.prepare('SELECT email,success,created_at FROM login_attempts ORDER BY id DESC LIMIT 100').all()));
app.get('*', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`AFEBS Royal Academy is running at http://localhost:${PORT}`));
