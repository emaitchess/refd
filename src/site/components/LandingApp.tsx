import { Landing } from '@/pages/Landing';
import { AuthProvider } from '@/providers/auth';

const LandingApp = () => (
  <AuthProvider>
    <Landing />
  </AuthProvider>
);

export default LandingApp;
