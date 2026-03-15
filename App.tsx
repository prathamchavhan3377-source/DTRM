import React, { useState, useEffect } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  addDoc, 
  updateDoc,
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile, Donation, UserRole } from './types';
import { Navbar } from './components/Navbar';
import { DonationCard } from './components/DonationCard';
import { DonationForm } from './components/DonationForm';
import { Heart, Utensils, Shield, Users, ArrowRight, Loader2, Mail, Lock, Building2, Phone, MapPin, AlertCircle } from 'lucide-react';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We don't throw here to avoid crashing the app, but we log it clearly
}

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState('home');
  const [donations, setDonations] = useState<Donation[]>([]);
  const [showDonationForm, setShowDonationForm] = useState(false);
  const [authError, setAuthError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          setUser(userDoc.data() as UserProfile);
          setCurrentPage('dashboard');
        } else {
          // If user exists in Auth but not in Firestore, they might be mid-signup
          setCurrentPage('signup-details');
        }
      } else {
        setUser(null);
        if (currentPage === 'dashboard') setCurrentPage('home');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Donations Listener
  useEffect(() => {
    if (!user) return;

    let q;
    if (user.role === 'donor') {
      q = query(collection(db, 'donations'), where('donorId', '==', user.uid), orderBy('createdAt', 'desc'));
    } else {
      q = query(collection(db, 'donations'), orderBy('createdAt', 'desc'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Donation));
      setDonations(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'donations');
    });

    return () => unsubscribe();
  }, [user]);

  // Test Connection
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    setCurrentPage('home');
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthError('');
    const email = e.currentTarget.email.value;
    const password = e.currentTarget.password.value;

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error: any) {
      console.error("Login error:", error);
      if (error.code === 'auth/operation-not-allowed') {
        setAuthError('Email/Password login is not enabled. Please enable it in Firebase Console or use Google Login.');
      } else if (error.code === 'auth/unauthorized-domain') {
        setAuthError('This domain is not authorized in Firebase. Please add this URL to "Authorized domains" in Firebase Console > Authentication > Settings.');
      } else {
        setAuthError(error.message);
      }
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError('');
    const provider = new GoogleAuthProvider();
    try {
      const res = await signInWithPopup(auth, provider);
      const userDoc = await getDoc(doc(db, 'users', res.user.uid));
      
      if (!userDoc.exists()) {
        // New user via Google - need to collect role and org name
        // For simplicity in this demo, we'll redirect to a "complete profile" state
        // or just default them to a donor if they don't exist
        setCurrentPage('signup-details');
      } else {
        setUser(userDoc.data() as UserProfile);
        setCurrentPage('dashboard');
      }
    } catch (error: any) {
      console.error("Google login error:", error);
      if (error.code === 'auth/operation-not-allowed') {
        setAuthError('Google login is not enabled in Firebase Console. Please enable it in the Authentication tab.');
      } else if (error.code === 'auth/unauthorized-domain') {
        setAuthError('This domain is not authorized in Firebase. Please add this URL to "Authorized domains" in Firebase Console > Authentication > Settings.');
      } else {
        setAuthError(error.message);
      }
    }
  };

  const handleCompleteProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    
    const role = e.currentTarget.role.value as UserRole;
    const orgName = e.currentTarget.orgName.value;
    const phone = e.currentTarget.phone.value;
    const address = e.currentTarget.address.value;

    try {
      const newUser: UserProfile = {
        uid: auth.currentUser.uid,
        email: auth.currentUser.email || '',
        role,
        organizationName: orgName,
        phoneNumber: phone,
        address,
        createdAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'users', auth.currentUser.uid), newUser);
      setUser(newUser);
      setCurrentPage('dashboard');
    } catch (error: any) {
      console.error("Complete profile error:", error);
      if (error.code === 'permission-denied') {
        handleFirestoreError(error, OperationType.WRITE, `users/${auth.currentUser?.uid}`);
        setAuthError('Permission denied when saving profile. Please check Firestore rules.');
      } else {
        setAuthError(error.message);
      }
    }
  };

  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthError('');
    const email = e.currentTarget.email.value;
    const password = e.currentTarget.password.value;
    const role = e.currentTarget.role.value as UserRole;
    const orgName = e.currentTarget.orgName.value;
    const phone = e.currentTarget.phone.value;
    const address = e.currentTarget.address.value;

    try {
      const res = await createUserWithEmailAndPassword(auth, email, password);
      const newUser: UserProfile = {
        uid: res.user.uid,
        email,
        role,
        organizationName: orgName,
        phoneNumber: phone,
        address,
        createdAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'users', res.user.uid), newUser);
      setUser(newUser);
      setCurrentPage('dashboard');
    } catch (error: any) {
      console.error("Signup error:", error);
      if (error.code === 'auth/unauthorized-domain') {
        setAuthError('This domain is not authorized in Firebase. Please add this URL to "Authorized domains" in Firebase Console > Authentication > Settings.');
      } else if (error.code === 'permission-denied') {
        handleFirestoreError(error, OperationType.WRITE, `users/${auth.currentUser?.uid}`);
        setAuthError('Permission denied when creating user profile. Please check Firestore rules.');
      } else {
        setAuthError(error.message);
      }
    }
  };

  const postDonation = async (data: any) => {
    if (!user) return;
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'donations'), {
        ...data,
        donorId: user.uid,
        donorName: user.organizationName,
        status: 'available',
        createdAt: serverTimestamp(),
      });
      setShowDonationForm(false);
    } catch (error) {
      console.error("Error posting donation:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const claimDonation = async (id: string) => {
    if (!user || user.role !== 'ngo') return;
    try {
      await updateDoc(doc(db, 'donations', id), {
        status: 'claimed',
        ngoId: user.uid,
        ngoName: user.organizationName,
        claimedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Error claiming donation:", error);
    }
  };

  const completeDonation = async (id: string) => {
    try {
      await updateDoc(doc(db, 'donations', id), {
        status: 'picked_up',
      });
    } catch (error) {
      console.error("Error completing donation:", error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <Loader2 className="animate-spin text-emerald-500" size={40} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900">
      <Navbar 
        user={user} 
        onLogout={handleLogout} 
        onNavigate={setCurrentPage} 
        currentPage={currentPage} 
      />

      <main>
        {currentPage === 'home' && (
          <div className="animate-in fade-in duration-700">
            {/* Hero Section */}
            <section className="relative overflow-hidden bg-white pt-16 pb-24 lg:pt-32 lg:pb-40">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="lg:grid lg:grid-cols-2 lg:gap-16 items-center">
                  <div>
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold uppercase tracking-wider mb-6">
                      <Heart size={14} />
                      Join the movement
                    </div>
                    <h1 className="text-5xl lg:text-7xl font-black tracking-tight leading-[0.9] mb-8">
                      FEED THE <span className="text-emerald-500">HUNGRY</span>,<br />
                      NOT THE <span className="text-zinc-400">BIN</span>.
                    </h1>
                    <p className="text-lg text-zinc-500 mb-10 max-w-lg leading-relaxed">
                      FoodShare connects restaurants, hotels, and event organizers with local NGOs to redistribute surplus food to those in need.
                    </p>
                    <div className="flex flex-wrap gap-4">
                      <button 
                        onClick={() => setCurrentPage('signup')}
                        className="px-8 py-4 bg-zinc-900 text-white rounded-2xl font-bold text-lg hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-900/20 flex items-center gap-2 group active:scale-95"
                      >
                        Start Donating
                        <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                      </button>
                      <button 
                        onClick={() => setCurrentPage('login')}
                        className="px-8 py-4 bg-white border-2 border-zinc-100 text-zinc-900 rounded-2xl font-bold text-lg hover:border-zinc-200 transition-all active:scale-95"
                      >
                        NGO Login
                      </button>
                    </div>
                  </div>
                  <div className="mt-16 lg:mt-0 relative">
                    <div className="aspect-[4/5] rounded-[2rem] overflow-hidden shadow-2xl rotate-2 hover:rotate-0 transition-transform duration-500">
                      <img 
                        src="https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&q=80&w=1000" 
                        alt="Sharing food" 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="absolute -bottom-6 -left-6 bg-white p-6 rounded-3xl shadow-xl border border-zinc-100 max-w-[240px] -rotate-3">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600">
                          <Users size={20} />
                        </div>
                        <span className="font-bold text-2xl">5,000+</span>
                      </div>
                      <p className="text-sm text-zinc-500 font-medium">Meals redistributed this month across the city.</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="absolute top-0 right-0 w-1/3 h-full bg-emerald-50/50 -skew-x-12 translate-x-1/2 -z-0" />
            </section>

            {/* Features */}
            <section className="py-24 bg-zinc-50">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center mb-16">
                  <h2 className="text-3xl font-black mb-4">How It Works</h2>
                  <p className="text-zinc-500 max-w-2xl mx-auto">A simple bridge between surplus and scarcity.</p>
                </div>
                <div className="grid md:grid-cols-3 gap-8">
                  {[
                    { icon: <Utensils />, title: "Donors Notify", desc: "Restaurants or event hosts post details about leftover food and pickup location." },
                    { icon: <Shield />, title: "NGOs Claim", desc: "Verified NGOs receive alerts and claim the donation for their community." },
                    { icon: <Users />, title: "Quick Pickup", desc: "NGOs arrange pickup and ensure the food reaches those who need it most." }
                  ].map((f, i) => (
                    <div key={i} className="bg-white p-8 rounded-3xl border border-zinc-100 shadow-sm hover:shadow-md transition-all">
                      <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-6">
                        {React.cloneElement(f.icon as React.ReactElement, { size: 28 })}
                      </div>
                      <h3 className="text-xl font-bold mb-3">{f.title}</h3>
                      <p className="text-zinc-500 leading-relaxed">{f.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}

        {currentPage === 'signup-details' && (
          <div className="min-h-[calc(100vh-64px)] flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl border border-zinc-100 overflow-hidden">
              <div className="p-8 sm:p-10">
                <h2 className="text-3xl font-black tracking-tight mb-2 text-center">Complete Profile</h2>
                <p className="text-zinc-500 font-medium text-center mb-10">Tell us more about your organization</p>
                
                <form onSubmit={handleCompleteProfile} className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">I am a...</label>
                    <select 
                      name="role"
                      className="w-full px-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium appearance-none"
                    >
                      <option value="donor">Food Donor (Restaurant/Hotel)</option>
                      <option value="ngo">NGO / Social Organization</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Organization Name</label>
                    <div className="relative">
                      <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                      <input 
                        name="orgName"
                        type="text" 
                        required
                        placeholder="e.g., Green Valley NGO"
                        className="w-full pl-12 pr-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Phone</label>
                      <div className="relative">
                        <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                        <input 
                          name="phone"
                          type="tel" 
                          placeholder="+1..."
                          className="w-full pl-12 pr-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">City</label>
                      <div className="relative">
                        <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                        <input 
                          name="address"
                          type="text" 
                          placeholder="City"
                          className="w-full pl-12 pr-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                        />
                      </div>
                    </div>
                  </div>

                  <button 
                    type="submit"
                    className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-bold text-lg hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-900/10 mt-4 active:scale-[0.98]"
                  >
                    Save & Continue
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
        
        {(currentPage === 'login' || currentPage === 'signup') && (
          <div className="min-h-[calc(100vh-64px)] flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl shadow-zinc-200/50 border border-zinc-100 overflow-hidden animate-in slide-in-from-bottom-8 duration-500">
              <div className="p-8 sm:p-10">
                <div className="text-center mb-10">
                  <h2 className="text-3xl font-black tracking-tight mb-2">
                    {currentPage === 'login' ? 'Welcome Back' : 'Create Account'}
                  </h2>
                  <p className="text-zinc-500 font-medium">
                    {currentPage === 'login' ? 'Login to manage your donations' : 'Join the FoodShare community'}
                  </p>
                </div>

                {authError && (
                  <div className="mb-6 p-5 bg-red-50 border border-red-100 rounded-2xl">
                    <div className="flex items-center gap-2 text-red-600 font-bold mb-2">
                      <AlertCircle size={18} />
                      <span>Authentication Error</span>
                    </div>
                    <p className="text-sm text-red-700 font-medium leading-relaxed">
                      {authError.includes('auth/operation-not-allowed') 
                        ? "This operation is not yet enabled in your Firebase Console. You must enable 'Email/Password' or 'Google' in the Authentication tab."
                        : authError.includes('auth/unauthorized-domain')
                        ? "This domain is not authorized. You must add the current URL to the 'Authorized domains' list in your Firebase Console."
                        : authError}
                    </p>
                    {(authError.includes('auth/operation-not-allowed') || authError.includes('auth/unauthorized-domain')) && (
                      <div className="mt-4 p-3 bg-white/50 rounded-xl border border-red-200">
                        <p className="text-xs font-bold text-red-800 uppercase mb-2">How to fix:</p>
                        <ol className="text-xs text-red-700 space-y-1 list-decimal ml-4">
                          <li>Go to <a href="https://console.firebase.google.com/" target="_blank" className="underline font-bold">Firebase Console</a></li>
                          <li>Select project: <code className="bg-red-100 px-1 rounded">gen-lang-client-0518495322</code></li>
                          <li>Go to <b>Authentication</b> &gt; <b>Settings</b> &gt; <b>Authorized domains</b></li>
                          <li>Add: <code className="bg-red-100 px-1 rounded">{window.location.hostname}</code></li>
                          {authError.includes('auth/operation-not-allowed') && (
                            <li>Go to <b>Sign-in method</b> and enable <b>Email/Password</b></li>
                          )}
                        </ol>
                      </div>
                    )}
                  </div>
                )}

                <form onSubmit={currentPage === 'login' ? handleLogin : handleSignup} className="space-y-5">
                  {currentPage === 'login' && (
                    <button 
                      type="button"
                      onClick={handleGoogleLogin}
                      className="w-full py-3.5 border-2 border-zinc-100 rounded-2xl flex items-center justify-center gap-3 font-bold hover:bg-zinc-50 transition-all mb-6 active:scale-[0.98]"
                    >
                      <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
                      Continue with Google
                    </button>
                  )}

                  {currentPage === 'login' && (
                    <div className="relative flex items-center gap-4 mb-6">
                      <div className="flex-1 h-px bg-zinc-100" />
                      <span className="text-xs font-bold text-zinc-400 uppercase">or</span>
                      <div className="flex-1 h-px bg-zinc-100" />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                      <input 
                        name="email"
                        type="email" 
                        required
                        placeholder="name@company.com"
                        className="w-full pl-12 pr-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Password</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                      <input 
                        name="password"
                        type="password" 
                        required
                        placeholder="••••••••"
                        className="w-full pl-12 pr-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                      />
                    </div>
                  </div>

                  {currentPage === 'signup' && (
                    <>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">I am a...</label>
                        <select 
                          name="role"
                          className="w-full px-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium appearance-none"
                        >
                          <option value="donor">Food Donor (Restaurant/Hotel)</option>
                          <option value="ngo">NGO / Social Organization</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Organization Name</label>
                        <div className="relative">
                          <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                          <input 
                            name="orgName"
                            type="text" 
                            required
                            placeholder="e.g., Green Valley NGO"
                            className="w-full pl-12 pr-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Phone</label>
                          <div className="relative">
                            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                            <input 
                              name="phone"
                              type="tel" 
                              placeholder="+1..."
                              className="w-full pl-12 pr-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">City</label>
                          <div className="relative">
                            <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                            <input 
                              name="address"
                              type="text" 
                              placeholder="City"
                              className="w-full pl-12 pr-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  <button 
                    type="submit"
                    className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-bold text-lg hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-900/10 mt-4 active:scale-[0.98]"
                  >
                    {currentPage === 'login' ? 'Sign In' : 'Create Account'}
                  </button>
                </form>

                <div className="mt-8 text-center">
                  <p className="text-zinc-500 font-medium text-sm">
                    {currentPage === 'login' ? "Don't have an account?" : "Already have an account?"}
                    <button 
                      onClick={() => setCurrentPage(currentPage === 'login' ? 'signup' : 'login')}
                      className="ml-2 text-emerald-600 font-bold hover:underline"
                    >
                      {currentPage === 'login' ? 'Sign up now' : 'Log in here'}
                    </button>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentPage === 'dashboard' && user && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
              <div>
                <h1 className="text-3xl font-black tracking-tight mb-2">
                  {user.role === 'donor' ? 'My Donations' : 'Available Food'}
                </h1>
                <p className="text-zinc-500 font-medium">
                  {user.role === 'donor' 
                    ? 'Manage your food contributions and track pickups.' 
                    : 'Browse surplus food available for pickup in your area.'}
                </p>
              </div>
              {user.role === 'donor' && (
                <button 
                  onClick={() => setShowDonationForm(true)}
                  className="px-6 py-3.5 bg-emerald-600 text-white rounded-2xl font-bold text-base hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 flex items-center gap-2 active:scale-95"
                >
                  <Utensils size={20} />
                  Donate Food
                </button>
              )}
            </div>

            {donations.length === 0 ? (
              <div className="bg-white rounded-[2rem] border-2 border-dashed border-zinc-200 p-16 text-center">
                <div className="w-20 h-20 bg-zinc-50 rounded-3xl flex items-center justify-center mx-auto mb-6 text-zinc-300">
                  <Utensils size={40} />
                </div>
                <h3 className="text-xl font-bold text-zinc-900 mb-2">No donations found</h3>
                <p className="text-zinc-500 max-w-xs mx-auto mb-8">
                  {user.role === 'donor' 
                    ? "You haven't posted any food donations yet. Start by clicking the button above!" 
                    : "There are no active food donations available at the moment. Check back soon!"}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {donations.map(donation => (
                  <DonationCard 
                    key={donation.id} 
                    donation={donation} 
                    isNgo={user.role === 'ngo'}
                    currentUserId={user.uid}
                    onClaim={claimDonation}
                    onComplete={completeDonation}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {showDonationForm && (
        <DonationForm 
          onClose={() => setShowDonationForm(false)} 
          onSubmit={postDonation}
          isSubmitting={isSubmitting}
        />
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-zinc-100 py-12 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center text-white">
                <Utensils size={18} />
              </div>
              <span className="text-lg font-bold tracking-tight text-zinc-900">FoodShare</span>
            </div>
            <p className="text-zinc-400 text-sm font-medium">© 2026 FoodShare Platform. All rights reserved.</p>
            <div className="flex gap-6">
              <a href="#" className="text-zinc-400 hover:text-zinc-900 transition-colors text-sm font-bold uppercase tracking-widest">Privacy</a>
              <a href="#" className="text-zinc-400 hover:text-zinc-900 transition-colors text-sm font-bold uppercase tracking-widest">Terms</a>
              <a href="#" className="text-zinc-400 hover:text-zinc-900 transition-colors text-sm font-bold uppercase tracking-widest">Contact</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
