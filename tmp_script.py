import sys

with open('apps/frontend/src/App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

login_ui = """
  const handleGoogleAuth = async (email, name, avatar) => {
    setSessionState('loading');
    try {
      const res = await fetch(`${API_BASE}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, avatar_url: avatar })
      });
      const data = await res.json();
      localStorage.setItem('kora_user_id', data.user_id);
      localStorage.setItem('kora_user_profile', JSON.stringify(data));
      setUserId(data.user_id);
      setUserProfile(data);
      if (data.onboarded) {
        setSessionState('dashboard');
        fetchData(data.user_id);
        loadChatHistory(data.user_id);
      } else {
        setSessionState('onboarding');
      }
    } catch (err) {
      console.error(err);
      setSessionState('login');
      setErrorBanner('Auth failed. Is backend running?');
    }
  };

  const submitOnboarding = async () => {
    setSessionState('loading');
    try {
      await fetch(`${API_BASE}/api/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, ...onboardData, name: userProfile.name })
      });
      const updatedProfile = { ...userProfile, ...onboardData, onboarded: true };
      localStorage.setItem('kora_user_profile', JSON.stringify(updatedProfile));
      setUserProfile(updatedProfile);
      setSessionState('dashboard');
      fetchData(userId);
      loadChatHistory(userId);
    } catch (err) {
      console.error(err);
      setSessionState('onboarding');
    }
  };

  if (sessionState === 'loading') {
    return (
      <div className="dashboard-container flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 rounded-full border-t-2 border-indigo-500 animate-spin"></div>
          <p className="text-zinc-500 font-mono text-xs uppercase tracking-widest">Booting Kora Engine...</p>
        </div>
      </div>
    );
  }

  if (sessionState === 'login') {
    return (
      <div className="dashboard-container flex items-center justify-center">
        <div className="card-premium w-96 p-8 flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center font-bold text-2xl text-white mb-6 shadow-xl shadow-indigo-500/20">
            K
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Welcome to Kora</h1>
          <p className="text-xs text-zinc-400 mb-8">Sign in to sync your timetable, milestones, and expenses across devices.</p>
          
          <div className="space-y-3 w-full">
            <button 
              onClick={() => handleGoogleAuth('arjun.sharma.iitm@gmail.com', 'Arjun Sharma', '')}
              className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 rounded-xl transition text-sm text-white"
            >
              <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-orange-500 to-amber-500 flex items-center justify-center font-bold text-[10px]">A</div>
              <div className="flex-1 text-left">Arjun Sharma (Demo)</div>
            </button>
            <button 
              onClick={() => handleGoogleAuth('karan.verma.cs@iitm.ac.in', 'Karan Verma', '')}
              className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 rounded-xl transition text-sm text-white"
            >
              <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-blue-500 to-cyan-500 flex items-center justify-center font-bold text-[10px]">K</div>
              <div className="flex-1 text-left">Karan Verma (Demo)</div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (sessionState === 'onboarding') {
    return (
      <div className="dashboard-container flex items-center justify-center">
        <div className="card-premium w-96 p-8">
          <h1 className="text-xl font-bold text-white mb-1">Almost there!</h1>
          <p className="text-xs text-zinc-400 mb-6">Let's set up your academic profile.</p>
          
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] uppercase font-mono text-zinc-500 mb-1">College</label>
              <input 
                type="text"
                value={onboardData.college}
                onChange={e => setOnboardData({...onboardData, college: e.target.value})}
                placeholder="e.g. IIT Madras"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-mono text-zinc-500 mb-1">Branch</label>
              <input 
                type="text"
                value={onboardData.branch}
                onChange={e => setOnboardData({...onboardData, branch: e.target.value})}
                placeholder="e.g. Computer Science"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-mono text-zinc-500 mb-1">Year</label>
              <input 
                type="number"
                value={onboardData.year}
                onChange={e => setOnboardData({...onboardData, year: parseInt(e.target.value)})}
                min="1" max="5"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button 
              onClick={submitOnboarding}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2.5 font-bold text-sm transition mt-2"
            >
              Complete Setup
            </button>
          </div>
        </div>
      </div>
    );
  }
"""

content = content.replace('  return (\n    <div className="dashboard-container">', login_ui + '\n  return (\n    <div className="dashboard-container">')

with open('apps/frontend/src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done')
