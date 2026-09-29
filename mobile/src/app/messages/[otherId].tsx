// One-to-one thread — the mobile port of app/messages/[otherId]/page.tsx, on
// the shared lib/direct-messages.ts. Payment reminders and announcements from a
// captain arrive here as ordinary messages, exactly as on the web.
//
// One addition over the web page: it polls for replies every 5s while the app
// is in the foreground, the way the team chat does. The web thread only
// updates on reload, which on a phone — where you put the app down and pick it
// up — reads as broken.

import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import {
  loadPersonName,
  loadThread,
  markThreadRead,
  sendDirectMessage,
  type DirectMessage,
} from '@/lib/direct-messages';
import { usePoll } from '~/use-poll';
import { ChatScreen, Composer } from '~/components/chat';

export default function Thread() {
  const { otherId } = useLocalSearchParams<{ otherId: string }>();
  const { user } = useAuth();
  const [name, setName] = useState('Conversation');
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !otherId) return;
    void (async () => {
      const n = await loadPersonName(otherId);
      if (n) setName(n);
      setMessages(await loadThread(user.id, otherId));
      setLoading(false);
      await markThreadRead(user.id, otherId);
    })();
  }, [user, otherId]);

  const newest = messages[messages.length - 1]?.created_at ?? null;

  const poll = useCallback(async () => {
    if (!user || !otherId) return;
    const rows = await loadThread(user.id, otherId, { after: newest });
    if (rows.length === 0) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const fresh = rows.filter((r) => !seen.has(r.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
    await markThreadRead(user.id, otherId);
  }, [user, otherId, newest]);

  usePoll(poll, 5000, !loading);

  const send = async (body: string): Promise<boolean> => {
    if (!user || !otherId) return false;
    setSending(true);
    const row = await sendDirectMessage(user.id, otherId, body);
    setSending(false);
    if (!row) {
      setError("Couldn't send that — try again.");
      return false;
    }
    setError(null);
    setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
    return true;
  };

  return (
    <ChatScreen
      title={name}
      banner={error}
      loading={loading}
      empty="No messages yet — say hello."
      messages={messages.map((m) => ({ id: m.id, senderId: m.sender_id, body: m.body, createdAt: m.created_at }))}
      myId={user?.id}
      group={false}
      footer={loading ? null : <Composer placeholder="Type a message..." sending={sending} onSend={send} />}
    />
  );
}
