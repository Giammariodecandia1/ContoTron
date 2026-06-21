import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { supabase } from '../lib/supabaseClient';
import styles from './LoginPage.module.css';

type AuthMode = 'login' | 'register';

export const LoginPage: React.FC = () => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const resetFeedback = () => {
    setError(null);
    setMessage(null);
  };

  const handleLogin = async () => {
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (loginError) throw loginError;
    navigate('/');
  };

  const handleRegister = async () => {
    const cleanName = displayName.trim();
    if (!cleanName) {
      setError('Inserisci il nome della persona.');
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: cleanName,
        },
      },
    });

    if (signUpError) throw signUpError;

    if (data.session) {
      await supabase
        .from('profiles')
        .upsert({
          id: data.user?.id,
          display_name: cleanName,
          email,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

      navigate('/onboarding');
      return;
    }

    setMessage('Account creato. Controlla la tua email per confermare l accesso, poi rientra da questa pagina.');
    setMode('login');
    setPassword('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    resetFeedback();
    setLoading(true);

    try {
      if (mode === 'login') {
        await handleLogin();
      } else {
        await handleRegister();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operazione non riuscita');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    resetFeedback();
  };

  return (
    <div className={styles.loginContainer}>
      <div className={styles.brand}>
        <h1>Contotron</h1>
        <p>Gestione familiare, report e documenti in un unico posto.</p>
      </div>

      <Card className={styles.loginCard}>
        <div className={styles.modeSwitch}>
          <button
            type="button"
            className={mode === 'login' ? styles.modeActive : ''}
            onClick={() => switchMode('login')}
          >
            Accedi
          </button>
          <button
            type="button"
            className={mode === 'register' ? styles.modeActive : ''}
            onClick={() => switchMode('register')}
          >
            Crea account
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}
        {message && <div className={styles.message}>{message}</div>}

        <form onSubmit={handleSubmit} className={styles.form}>
          {mode === 'register' && (
            <div className={styles.formGroup}>
              <label>Nome</label>
              <input
                type="text"
                required
                className={styles.input}
                value={displayName}
                onChange={event => setDisplayName(event.target.value)}
                placeholder="es. Giammario"
              />
            </div>
          )}

          <div className={styles.formGroup}>
            <label>Email</label>
            <input
              type="email"
              required
              className={styles.input}
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="tu@email.com"
              autoComplete="email"
            />
          </div>

          <div className={styles.formGroup}>
            <label>Password</label>
            <input
              type="password"
              required
              minLength={6}
              className={styles.input}
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="Minimo 6 caratteri"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          <Button type="submit" size="lg" className="mt-4" disabled={loading}>
            {loading ? 'Attendi...' : mode === 'login' ? 'Accedi' : 'Crea account'}
          </Button>
        </form>

        <p className={styles.footer}>
          {mode === 'login'
            ? 'Ogni famiglia vede solo i propri dati dopo il login.'
            : 'Dopo la registrazione creerai il tuo primo gruppo famiglia.'}
        </p>
      </Card>
    </div>
  );
};
