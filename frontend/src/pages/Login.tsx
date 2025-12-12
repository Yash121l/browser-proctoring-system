import React from "react";

export default function Login({ onLogin }: { onLogin: (t: string, userId: number, role: string) => void }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState("student");

  const submit = async () => {
    // Demo: use /auth/login for student, /auth/adminLogin for admin
    if (role === "admin") {
      const res = await fetch("/auth/adminLogin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adminId: email || "admin", secret: password || "changeme" }) });
      if (!res.ok) return alert("admin login failed");
      const { token } = await res.json();
      onLogin(token, 0, role);
    } else {
      // Student: simulate mapping email->userId, testId from input
      const userId = email || "student1";
      const testId = "quiz_101";
      const res = await fetch("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, testId }) });
      if (!res.ok) return alert("student login failed");
      const { token } = await res.json();
      onLogin(token, 1, role); // userId numeric mocked
    }
  };

  return (
    <div style={{ maxWidth: 360, margin: "40px auto", padding: 24, border: "1px solid #ddd", borderRadius: 8 }}>
      <h3>Login</h3>
      <select value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="student">Student</option>
        <option value="admin">Admin</option>
      </select>
      <input placeholder="Email/ID" value={email} onChange={(e) => setEmail(e.target.value)} style={{ display: "block", width: "100%", marginTop: 8 }} />
      <input type="password" placeholder="Password/Secret" value={password} onChange={(e) => setPassword(e.target.value)} style={{ display: "block", width: "100%", marginTop: 8 }} />
      <button onClick={submit} style={{ marginTop: 12, width: "100%" }}>Login</button>
    </div>
  );
}

