import React from "react";

export default function Login({ onLogin }: { onLogin: (t: string, role: "student" | "admin") => void }) {
  const [mode, setMode] = React.useState<"login" | "signup">("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<"student" | "admin">("student");

  const submit = async () => {
    if (mode === "signup") {
      const res = await fetch("/auth/user/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, role }) });
      if (!res.ok) return alert("signup failed");
      const { token } = await res.json();
      onLogin(token, role);
    } else {
      const res = await fetch("/auth/user/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (!res.ok) return alert("login failed");
      const { token, user } = await res.json();
      onLogin(token, user.role === "admin" ? "admin" : "student");
    }
  };

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 420, margin: "60px auto" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 className="heading">{mode === "login" ? "Welcome back" : "Create account"}</h2>
          <button className="btn secondary" onClick={() => setMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "Sign up" : "Log in"}</button>
        </div>
        <div style={{ marginTop: 12 }}>
          <label className="muted">Role</label>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as any)}>
            <option value="student">Student</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <input className="input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
          <button className="btn" onClick={submit}>{mode === "login" ? "Login" : "Sign up"}</button>
        </div>
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          You’ll be redirected to the {role === "admin" ? "Admin" : "Student"} dashboard after {mode}.
        </p>
      </div>
    </div>
  );
}
