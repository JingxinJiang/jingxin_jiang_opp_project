from __future__ import annotations

import sqlite3
from datetime import date, datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "projects.db"

app = Flask(__name__, static_folder="static", static_url_path="")


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(projects)").fetchall()}
    if "budget" not in cols:
        conn.execute("ALTER TABLE projects ADD COLUMN budget REAL")
        conn.commit()


def parse_date(value: str | None) -> date | None:
    if value is None or str(value).strip() == "":
        return None
    s = str(value).strip()[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    if d.get("budget") is not None:
        d["budget"] = float(d["budget"])
    return d


def validate_payload(data: dict, partial: bool = False) -> tuple[dict | None, str | None]:
    errors: list[str] = []

    def req(key: str, label: str, mx: int = 2000) -> str | None:
        v = data.get(key)
        if partial and (key not in data or v is None):
            return None
        if v is None or (isinstance(v, str) and not v.strip()):
            errors.append(f"{label} is required.")
            return None
        s = str(v).strip()
        if len(s) > mx:
            errors.append(f"{label} must be at most {mx} characters.")
        return s

    project_name = req("project_name", "Project name", 500)
    bureau = req("bureau", "Bureau", 200)
    status = req("status", "Status", 100)
    priority = req("priority", "Priority", 50)

    start_raw = data.get("start_date") if not partial else data.get("start_date", None)
    if partial and "start_date" not in data:
        start_date = None
    else:
        if start_raw is None or (isinstance(start_raw, str) and not str(start_raw).strip()):
            errors.append("Start date is required.")
            start_date = None
        else:
            start_date = parse_date(str(start_raw))
            if start_date is None:
                errors.append("Start date must be YYYY-MM-DD.")

    end_raw = data.get("end_date")
    if partial and "end_date" not in data:
        end_date = None
    else:
        if end_raw is None or (isinstance(end_raw, str) and str(end_raw).strip() == ""):
            end_date = None
        else:
            end_date = parse_date(str(end_raw))
            if end_date is None:
                errors.append("End date must be YYYY-MM-DD or empty.")

    desc = data.get("description")
    if partial and "description" not in data:
        description = None
    else:
        description = None if desc is None else str(desc).strip()
        if description == "":
            description = None
        if description and len(description) > 5000:
            errors.append("Description must be at most 5000 characters.")

    budget_val = data.get("budget")
    if partial and "budget" not in data:
        budget = None
    else:
        if budget_val is None or (isinstance(budget_val, str) and budget_val.strip() == ""):
            budget = None
        else:
            try:
                budget = float(budget_val)
            except (TypeError, ValueError):
                errors.append("Budget must be a number.")
                budget = None
            else:
                if budget < 0:
                    errors.append("Budget cannot be negative.")

    if start_date and end_date and end_date < start_date:
        errors.append("End date cannot be before start date.")

    if errors:
        return None, "; ".join(errors)

    out: dict = {}
    if project_name is not None:
        out["project_name"] = project_name
    if bureau is not None:
        out["bureau"] = bureau
    if status is not None:
        out["status"] = status
    if priority is not None:
        out["priority"] = priority
    if start_date is not None:
        out["start_date"] = start_date.isoformat()
    if end_date is not None or (not partial and (end_raw is None or str(end_raw).strip() == "")):
        out["end_date"] = end_date.isoformat() if end_date else None
    if description is not None or (not partial and "description" in data):
        out["description"] = description
    if budget is not None or (not partial and (budget_val is None or str(budget_val).strip() == "")):
        out["budget"] = budget

    return out, None

#API Endpoints
@app.get("/api/meta")
def api_meta():
    with get_conn() as conn:
        migrate(conn)
        bureaus = [r[0] for r in conn.execute("SELECT DISTINCT bureau FROM projects ORDER BY bureau")]
        statuses = [r[0] for r in conn.execute("SELECT DISTINCT status FROM projects ORDER BY status")]
        priorities = [r[0] for r in conn.execute("SELECT DISTINCT priority FROM projects ORDER BY priority")]
    return jsonify({"bureaus": bureaus, "statuses": statuses, "priorities": priorities})


@app.get("/api/stats")
def api_stats():
    with get_conn() as conn:
        migrate(conn)
        total = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
        by_status = dict(conn.execute("SELECT status, COUNT(*) FROM projects GROUP BY status").fetchall())
        by_bureau = dict(conn.execute("SELECT bureau, COUNT(*) FROM projects GROUP BY bureau").fetchall())
        by_priority = dict(conn.execute("SELECT priority, COUNT(*) FROM projects GROUP BY priority").fetchall())
        budget_row = conn.execute(
            "SELECT COUNT(*) AS n, COALESCE(SUM(budget), 0) AS total, COALESCE(AVG(budget), 0) AS avg "
            "FROM projects WHERE budget IS NOT NULL"
        ).fetchone()
        with_budget = budget_row["n"]
        budget_total = float(budget_row["total"])
        budget_avg = float(budget_row["avg"]) if with_budget else 0.0

    return jsonify(
        {
            "total_projects": total,
            "by_status": by_status,
            "by_bureau": by_bureau,
            "by_priority": by_priority,
            "budget": {
                "projects_with_budget": with_budget,
                "total": budget_total,
                "average": budget_avg,
            },
        }
    )


@app.get("/api/projects")
def api_projects_list():
    sort = request.args.get("sort", "start_date")
    order = request.args.get("order", "desc").lower()
    status_f = request.args.get("status", "").strip()
    bureau_f = request.args.get("bureau", "").strip()
    priority_f = request.args.get("priority", "").strip()
    search = request.args.get("search", "").strip()

    allowed_sort = {
        "id": "id",
        "project_name": "project_name",
        "bureau": "bureau",
        "status": "status",
        "priority": "priority",
        "start_date": "start_date",
        "end_date": "end_date",
        "budget": "budget",
    }
    col = allowed_sort.get(sort, "start_date")
    direction = "ASC" if order == "asc" else "DESC"

    where: list[str] = []
    params: list = []
    if status_f:
        where.append("status = ?")
        params.append(status_f)
    if bureau_f:
        where.append("bureau = ?")
        params.append(bureau_f)
    if priority_f:
        where.append("priority = ?")
        params.append(priority_f)
    if search:
        where.append("(project_name LIKE ? OR description LIKE ? OR bureau LIKE ?)")
        like = f"%{search}%"
        params.extend([like, like, like])

    wh = (" WHERE " + " AND ".join(where)) if where else ""
    # SQLite < 3.30 may not support NULLS LAST in all builds; omit for compatibility
    sql = f"SELECT * FROM projects{wh} ORDER BY {col} {direction}, id {direction}"

    with get_conn() as conn:
        migrate(conn)
        rows = conn.execute(sql, params).fetchall()

    return jsonify([row_to_dict(r) for r in rows])


@app.get("/api/projects/<int:project_id>")
def api_project_get(project_id: int):
    with get_conn() as conn:
        migrate(conn)
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    return jsonify(row_to_dict(row))


@app.post("/api/projects")
def api_project_create():
    data = request.get_json(silent=True) or {}
    payload, err = validate_payload(data, partial=False)
    if err:
        return jsonify({"error": err}), 400
    assert payload is not None
    with get_conn() as conn:
        migrate(conn)
        cur = conn.execute(
            """
            INSERT INTO projects (project_name, bureau, status, priority, start_date, end_date, description, budget)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload["project_name"],
                payload["bureau"],
                payload["status"],
                payload["priority"],
                payload["start_date"],
                payload.get("end_date"),
                payload.get("description"),
                payload.get("budget"),
            ),
        )
        new_id = cur.lastrowid
        conn.commit()
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (new_id,)).fetchone()
    return jsonify(row_to_dict(row)), 201


@app.put("/api/projects/<int:project_id>")
def api_project_update(project_id: int):
    data = request.get_json(silent=True) or {}
    with get_conn() as conn:
        migrate(conn)
        existing = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Not found"}), 404

    merged = {**dict(existing), **data}
    payload, err = validate_payload(merged, partial=False)
    if err:
        return jsonify({"error": err}), 400
    assert payload is not None

    with get_conn() as conn:
        conn.execute(
            """
            UPDATE projects SET
                project_name = ?, bureau = ?, status = ?, priority = ?,
                start_date = ?, end_date = ?, description = ?, budget = ?
            WHERE id = ?
            """,
            (
                payload["project_name"],
                payload["bureau"],
                payload["status"],
                payload["priority"],
                payload["start_date"],
                payload.get("end_date"),
                payload.get("description"),
                payload.get("budget"),
                project_id,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    return jsonify(row_to_dict(row))


@app.delete("/api/projects/<int:project_id>")
def api_project_delete(project_id: int):
    with get_conn() as conn:
        migrate(conn)
        cur = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()
        deleted = cur.rowcount
    if not deleted:
        return jsonify({"error": "Not found"}), 404
    return jsonify({"ok": True})


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    with get_conn() as c:
        migrate(c)
    app.run(host="127.0.0.1", port=5000, debug=True)
