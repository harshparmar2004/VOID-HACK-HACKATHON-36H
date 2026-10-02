// The one place the API address is set. Override with VITE_API_BASE in a Vite env file.
// The production build is served by the API itself, so its address is relative.
const LOCAL_API_BASE = import.meta.env.PROD ? "/api" : "http://127.0.0.1:8000/api";

export const API_BASE = (import.meta.env.VITE_API_BASE || LOCAL_API_BASE).replace(/\/+$/, "");
