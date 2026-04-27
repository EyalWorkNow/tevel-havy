
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
// import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyBY1B-CbFm3cNGlA1ObeJt8yP--qRqvIL0",
  authDomain: "tevel-poc.firebaseapp.com",
  projectId: "tevel-poc",
  storageBucket: "tevel-poc.firebasestorage.app",
  messagingSenderId: "92063050872",
  appId: "1:92063050872:web:5338acdd8382965cadd18d",
  measurementId: "G-C7NEVMX6PD"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// export const analytics = getAnalytics(app);
