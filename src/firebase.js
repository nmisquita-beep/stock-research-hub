import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyBrnbrLzE9IWctGUhxoX-xgUbZ2yKTCZMk",
  authDomain: "stock-research-hub.firebaseapp.com",
  projectId: "stock-research-hub",
  storageBucket: "stock-research-hub.firebasestorage.app",
  messagingSenderId: "187102931075",
  appId: "1:187102931075:web:457ca5f30965ee6ea513b6"
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()
