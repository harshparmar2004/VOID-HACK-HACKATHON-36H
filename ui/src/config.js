// The one place the API address is set. Override with VITE_API_BASE in a Vite env file.
const LOCAL_API_BASE = "http://127.0.0.1:8000/api";

export const API_BASE = (import.meta.env.VITE_API_BASE || LOCAL_API_BASE).replace(/\/+$/, "");
