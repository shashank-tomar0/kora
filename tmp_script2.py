import re

with open('apps/mobile/src/app/index.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Change initial step to 'loading'
content = content.replace("const [step, setStep] = useState('app'); // Boot directly to dashboard tab screen", "const [step, setStep] = useState('loading');")

# Remove hardcoded userId
content = content.replace("const [userId, setUserId] = useState('9392ba14-f8c0-4098-b790-dab7b120453e');", "const [userId, setUserId] = useState('');")
content = content.replace("const [userEmail, setUserEmail] = useState('arjun.sharma.iitm@gmail.com');", "const [userEmail, setUserEmail] = useState('');")
content = content.replace("const [userAvatar, setUserAvatar] = useState('https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=120&h=120&q=80');", "const [userAvatar, setUserAvatar] = useState('');")

new_init = '''const init = async () => {
      let isLogged = false;
      let finalUrl = apiBaseUrl;
      try {
        const storedUserId = await AsyncStorage.getItem('kora_user_id');
        const storedApiUrl = await AsyncStorage.getItem('kora_api_url');
        const storedProfile = await AsyncStorage.getItem('kora_user_profile');
        if (storedUserId && storedProfile) {
          setUserId(storedUserId);
          const p = JSON.parse(storedProfile);
          setUserEmail(p.email || '');
          setUserAvatar(p.avatar_url || '');
          isLogged = true;
        }
        if (storedApiUrl) {
          setApiBaseUrl(storedApiUrl);
          finalUrl = storedApiUrl;
        }
      } catch (_) {}

      const activeUrl = await detectBackend();
      if (activeUrl) finalUrl = activeUrl;
      try { await AsyncStorage.setItem('kora_api_url', finalUrl); } catch (_) {}
      
      if (isLogged) {
        await syncData(finalUrl);
        triggerVoiceGreeting(finalUrl);
        setStep('app');
      } else {
        setStep('login');
      }
    };'''

content = re.sub(r'const init = async \(\) => \{.*?triggerVoiceGreeting\(finalUrl\);\n    \};', new_init.strip(), content, flags=re.DOTALL)

with open('apps/mobile/src/app/index.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done')
