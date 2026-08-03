import React, { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currUser) => {
      setUser(currUser);
      if (currUser) {
        // Enforce user document creation
        const userRef = doc(db, "users", currUser.uid);
        const docSnap = await getDoc(userRef);
        if (!docSnap.exists()) {
          await setDoc(userRef, {
            userId: currUser.uid,
            email: currUser.email,
            createdAt: new Date().toISOString(),
          });
        }
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
