require('dotenv').config();
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const express = require('express');
const mysql = require('mysql2');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// --- CONFIGURATION DOSSIER UPLOADS ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, 'uploads/'); },
  filename: (req, file, cb) => { cb(null, Date.now() + '-' + file.originalname); }
});
const upload = multer({ storage: storage });

// --- MIDDLEWARES ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- GESTION DES FICHIERS STATIQUES (Correction "Cannot GET") ---
// Cette ligne permet d'accéder à /service au lieu de /service.html
app.use(express.static(path.join(__dirname, 'fichierprinc'), { extensions: ['html'] }));
app.use('/img', express.static(path.join(__dirname, 'img')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- CONNEXION MYSQL (Hybride Local/Railway) ---
const db = mysql.createConnection(process.env.DATABASE_URL || {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  ssl: { rejectUnauthorized: false }
});

db.connect((err) => {
  if (err) {
    console.error('❌ Erreur de connexion MySQL :', err);
    return;
  }
  console.log('✅ Connecté à la base de données MySQL');
});

// --- NODEMAILER ---
const transporter = nodemailer.createTransport({
  service: 'gmail', 
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// --- ROUTES ---

// Accueil
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'fichierprinc', 'index.html'));
});

// Mot de passe oublié
app.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  db.query("SELECT * FROM clients WHERE email = ?", [email], (err, results) => {
    if (err) return res.status(500).send("Erreur base de données.");
    if (results.length === 0) return res.status(404).send("Cet email n'existe pas.");

    const token = crypto.randomBytes(20).toString('hex');
    const expires = new Date(Date.now() + 3600000); 

    db.query("UPDATE clients SET reset_token = ?, reset_expires = ? WHERE email = ?", 
    [token, expires, email], (err) => {
      const appUrl = process.env.APP_URL || `http://localhost:${port}`;
      const resetLink = `${appUrl}/reset-password?token=${token}`; // Suppression du .html car géré par static
      
      const mailOptions = {
        from: `"Expert Sabjon Mali" <${process.env.EMAIL_USER}>`, 
        to: email,
        subject: 'Réinitialisation de votre mot de passe',
        html: `
          <div style="font-family: sans-serif; color: #1e213a; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
            <h2 style="color: #1e213a; text-align: center;">Réinitialisation de mot de passe</h2>
            <p>Bonjour,</p>
            <p>Cliquez ci-dessous pour changer votre mot de passe :</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="${resetLink}" style="background-color: #1e213a; color: #d8c09d; padding: 15px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">CHANGER MON MOT DE PASSE</a>
            </div>
          </div>`
      };

      transporter.sendMail(mailOptions, (error) => {
        if (error) return res.status(500).send("Erreur lors de l'envoi de l'email.");
        res.status(200).send("Email de récupération envoyé !");
      });
    });
  });
});

// Réinitialisation mot de passe
app.post('/reset-password', (req, res) => {
  const { token, newPassword } = req.body;
  const sql = "SELECT * FROM clients WHERE reset_token = ? AND reset_expires > NOW()";
  db.query(sql, [token], (err, results) => {
    if (err || results.length === 0) return res.status(400).send("Lien invalide ou expiré.");
    const updateSql = "UPDATE clients SET password = ?, reset_token = NULL, reset_expires = NULL WHERE reset_token = ?";
    db.query(updateSql, [newPassword, token], (err) => {
      if (err) return res.status(500).send("Erreur mise à jour.");
      res.status(200).send("Succès !");
    });
  });
});

// Inscription
app.post('/register', (req, res) => {
  const { nom, email, password } = req.body;
  const sql = "INSERT INTO clients (nom, email, password) VALUES (?, ?, ?)";
  db.query(sql, [nom, email, password], (err) => {
    if (err) return res.status(500).send("Erreur inscription");
    res.redirect('/loginclient');
  });
});

// Login Client
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.query("SELECT * FROM clients WHERE email = ? AND password = ?", [email, password], (err, results) => {
    if (err || results.length === 0) return res.redirect('/erreurlogin');
    res.send(`<script>localStorage.setItem("client_email", "${email}"); window.location.href = "/cclient";</script>`);
  });
});

// Envoi Demande
app.post('/envoyerdemande', (req, res) => {
  const { nom, email, telephone, type_document, message } = req.body;
  const sql = "INSERT INTO demandes (nom, email, telephone, type_document, message) VALUES (?, ?, ?, ?, ?)";
  db.query(sql, [nom, email, telephone, type_document, message], (err) => {
    if (err) return res.redirect('/erreurlogin');
    res.redirect('/merci');
  });
});

// Messagerie Admin -> Client
app.post('/envoyermessage', upload.single('document'), (req, res) => {
  const { client_email, message } = req.body;
  const document_url = req.file ? `/uploads/${req.file.filename}` : null;
  const sql = "INSERT INTO messages (client_email, message, expediteur, document_url) VALUES (?, ?, 'admin', ?)";
  db.query(sql, [client_email, message, document_url], (err) => {
    if (err) return res.redirect('/erreuradmin');
    res.redirect('/cadmin');
  });
});

// API : Récupérer messages d'un client
app.get('/api/messages/:email', (req, res) => {
  db.query("SELECT * FROM messages WHERE client_email = ? ORDER BY date_envoi ASC", [req.params.email], (err, results) => {
    res.json(err ? [] : results);
  });
});

// Message Client -> Admin
app.post('/clientmessage', upload.single('document'), (req, res) => {
  const { client_email, message } = req.body;
  const document_url = req.file ? `/uploads/${req.file.filename}` : null;
  const sql = "INSERT INTO messages (client_email, message, expediteur, document_url) VALUES (?, ?, 'client', ?)";
  db.query(sql, [client_email, message, document_url], (err) => {
    res.status(err ? 500 : 200).send(err ? "Erreur" : "OK");
  });
});

// API : Listes des clients pour l'admin
app.get('/api/messages_clients', (req, res) => {
  const sql = "SELECT client_email, MAX(date_envoi) AS last_message FROM messages GROUP BY client_email ORDER BY last_message DESC";
  db.query(sql, (err, results) => res.json(err ? [] : results));
});

app.get('/api/demandes', (req, res) => {
  db.query("SELECT * FROM demandes ORDER BY date_envoi DESC", (err, results) => res.json(err ? [] : results));
});

// Login Admin
app.post('/loginadmin', (req, res) => {
  const { username, password } = req.body;
  db.query("SELECT * FROM admin WHERE username = ? AND password = ?", [username, password], (err, results) => {
    if (err || results.length === 0) return res.status(401).redirect("/erreurlogin");
    res.redirect('/cadmin');
  });
});

// Recherche Admin
app.get('/api/recherche_clients', (req, res) => {
  const search = `%${req.query.q}%`;
  db.query("SELECT nom, email FROM clients WHERE email LIKE ? OR nom LIKE ? LIMIT 10", [search, search], (err, results) => {
    res.json(err ? [] : results);
  });
});

// LANCEMENT DU SERVEUR
app.listen(port, () => {
  console.log(`🚀 Serveur en ligne sur le port ${port}`);
});