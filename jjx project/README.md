# Project Management Dashboard

A lightweight dashboard for tracking projects, bureaus, timelines, priorities, and budgets.

The app uses:

- **Backend:** Python + Flask (`app.py`)
- **Database:** SQLite (`projects.db`)
- **Frontend:** HTML/CSS/JavaScript (`static/`)
- **Charts:** Chart.js (loaded from CDN)

## Features

- Create, view, update, and delete projects
- Filter by status, bureau, and priority
- Search by project name, bureau, or description
- Sort by date, name, budget, etc.
- Visualizations for status, bureau, and priority distribution
- Timeline view from project start to end (or ongoing)
- Server-side and client-side validation

## Project Structure

```text
.
├── app.py
├── projects.db
├── README.md
├── requirement.txt
└── static/
    ├── index.html
    ├── css/
    │   └── styles.css
    └── js/
        └── app.js
```

## Requirements

- VS Code
- Python 3.10+ (Recommended Python 3.14.4)
- `pip`

## Setup

1. Create and activate a virtual environment (recommended):

```bash
python -m venv .venv
```

- Windows (PowerShell):

```bash
.venv\Scripts\Activate.ps1
```

- macOS/Linux:

```bash
source .venv/bin/activate
```

2. Install dependencies:

```bash
pip install flask
```

3. Run the app:

```bash
python app.py
```

4. Open your browser:

```text
http://127.0.0.1:5000
```

## API Endpoints

- `GET /api/meta`  
  Returns distinct values for `bureaus`, `statuses`, and `priorities`.

- `GET /api/stats`  
  Returns totals and grouped counts, plus budget aggregate info.

- `GET /api/projects`  
  Lists projects with optional query params:
  - `search`
  - `status`
  - `bureau`
  - `priority`
  - `sort` (`id`, `project_name`, `bureau`, `status`, `priority`, `start_date`, `end_date`, `budget`)
  - `order` (`asc` or `desc`)

- `GET /api/projects/<id>`  
  Returns a single project.

- `POST /api/projects`  
  Creates a project.

- `PUT /api/projects/<id>`  
  Updates a project.

- `DELETE /api/projects/<id>`  
  Deletes a project.

## Data Validation

Validation is enforced in both frontend and backend. Backend (`app.py`) is the source of truth.

- Required: `project_name`, `bureau`, `status`, `priority`, `start_date`
- Date format: `YYYY-MM-DD`
- `end_date` cannot be before `start_date`
- `budget` must be a non-negative number (or empty)
- Max lengths:
  - `project_name`: 500
  - `bureau`: 200
  - `status`: 100
  - `priority`: 50
  - `description`: 5000

## Notes

- The app includes a lightweight migration step on startup to add a `budget` column if needed.
- Flask runs in debug mode by default in `app.py`.
