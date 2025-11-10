const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// DEBUG: Log all requests
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Explicit admin routes
app.get('/admin', (req, res) => {
    console.log('Admin route accessed');
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin.html', (req, res) => {
    console.log('Admin.html route accessed');
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API routes
const projectsFile = path.join(__dirname, 'data', 'projects.json');

if (!fs.existsSync(path.dirname(projectsFile))) {
    fs.mkdirSync(path.dirname(projectsFile), { recursive: true });
}

app.get('/api/projects', (req, res) => {
    try {
        const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
        res.json(projects);
    } catch (error) {
        res.json([]);
    }
});

app.post('/api/projects', (req, res) => {
    try {
        const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf8') || '[]');
        const newProject = {
            id: projects.length > 0 ? Math.max(...projects.map(p => p.id)) + 1 : 1,
            ...req.body,
            createdAt: new Date().toISOString()
        };
        projects.push(newProject);
        fs.writeFileSync(projectsFile, JSON.stringify(projects, null, 2));
        res.json(newProject);
    } catch (error) {
        res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
    }
});

// Root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all route
app.get('*', (req, res) => {
    console.log(`Catch-all route: ${req.url}`);
    res.status(404).send('Page not found');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Admin panel should be at: http://localhost:${PORT}/admin`);
});
async function addProject() {
    const projectData = {
        title: document.getElementById('title').value,
        description: document.getElementById('description').value,
        technologies: document.getElementById('technologies').value.split(','),
        githubUrl: document.getElementById('githubUrl').value,
        liveUrl: document.getElementById('liveUrl').value,
        imageUrl: document.getElementById('imageUrl').value
    };

    try {
        const response = await fetch('/api/projects', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(projectData)
        });

        if (response.ok) {
            alert('Projet ajouté avec succès!');
            loadProjects(); // Recharger la liste
        }
    } catch (error) {
        alert('Erreur: ' + error);
    }
}
async function loadProjects() {
    try {
        const response = await fetch('/api/projects');
        const projects = await response.json();
        displayProjects(projects);
    } catch (error) {
        console.error('Erreur chargement projets:', error);
    }
}