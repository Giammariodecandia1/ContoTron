import React, { useMemo, useRef, useState } from 'react';
import { Bot, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAiConfiguration, useAuth, useHousehold } from '../hooks';
import {
  askFinancialAssistant,
  type FinancialChatTurn,
} from '../lib/aiFinancialAssistant';
import styles from './AiAssistantPage.module.css';

const suggestions = [
  'Per cosa ho speso maggiormente questo mese?',
  'Quanto ha speso il nucleo e quanto ho speso io questo mese?',
  'Come siamo messi con il budget del mese?',
  'Qual e la situazione dello Split questo mese?',
];

export const AiAssistantPage: React.FC = () => {
  const { configuration } = useAiConfiguration();
  const { user } = useAuth();
  const { household } = useHousehold();
  const [turns, setTurns] = useState<FinancialChatTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canAsk = Boolean(configuration && household && user && question.trim() && !loading);
  const welcome = useMemo(() => user?.display_name
    ? `Ciao ${user.display_name}, cosa vuoi sapere sulle tue spese?`
    : 'Cosa vuoi sapere sulle tue spese?', [user?.display_name]);

  const submitQuestion = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const prompt = question.trim();
    if (!configuration || !household || !user || !prompt || loading) return;

    setQuestion('');
    setError(null);
    setLoading(true);
    const previousTurns = [...turns];
    setTurns(current => [...current, { role: 'user', content: prompt }]);
    try {
      const answer = await askFinancialAssistant({
        configuration,
        householdId: household.id,
        userId: user.id,
        currency: household.currency || 'EUR',
        question: prompt,
        history: previousTurns,
      });
      setTurns(current => [...current, { role: 'assistant', content: answer }]);
    } catch (assistantError) {
      setError(assistantError instanceof Error ? assistantError.message : 'L assistente non e riuscito a rispondere.');
    } finally {
      setLoading(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Assistente Contotron</h1>
          <p className="text-muted">Interroga le tue spese con l AI configurata nel browser.</p>
        </div>
        <span className={styles.readOnlyBadge}><ShieldCheck size={16} /> Sola lettura</span>
      </header>

      <Card className={styles.chatCard}>
        <div className={styles.chatStream} aria-live="polite">
          {turns.length === 0 && (
            <div className={styles.welcome}>
              <div className={styles.botIcon}><Bot size={30} /></div>
              <h2>{welcome}</h2>
              <p>Consulto soltanto i dati necessari alla domanda. Non posso modificare o cancellare transazioni.</p>
              <div className={styles.suggestions}>
                {suggestions.map(suggestion => (
                  <button key={suggestion} type="button" onClick={() => {
                    setQuestion(suggestion);
                    inputRef.current?.focus();
                  }}>
                    <Sparkles size={15} /> {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn, index) => (
            <div key={`${turn.role}-${index}`} className={`${styles.message} ${turn.role === 'user' ? styles.userMessage : styles.assistantMessage}`}>
              <strong>{turn.role === 'user' ? 'Tu' : 'Contotron AI'}</strong>
              <p>{turn.content}</p>
            </div>
          ))}
          {loading && (
            <div className={`${styles.message} ${styles.assistantMessage}`}>
              <strong>Contotron AI</strong>
              <p className={styles.thinking}>Sto consultando i dati necessari...</p>
            </div>
          )}
          {error && <div className={styles.error}>{error}</div>}
        </div>

        <form className={styles.composer} onSubmit={submitQuestion}>
          <textarea
            ref={inputRef}
            value={question}
            onChange={event => setQuestion(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submitQuestion();
              }
            }}
            rows={2}
            placeholder="Esempio: per cosa ho speso di piu questo mese?"
            disabled={loading}
          />
          <Button type="submit" icon={<Send size={18} />} disabled={!canAsk}>
            Invia
          </Button>
        </form>
        <p className={styles.disclaimer}>Le risposte sono generate dal servizio configurato dall utente. Controlla sempre importi e periodo indicati.</p>
      </Card>
    </div>
  );
};
