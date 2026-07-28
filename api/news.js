import { supabase } from './_lib/supabase.js';
import { requireAdmin, allowCors } from './_lib/auth.js';
import { newsToJson } from './_lib/serialize.js';

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('news_posts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      res.status(200).json(data.map(newsToJson));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudieron cargar las noticias.' });
    }
    return;
  }

  if (req.method === 'POST') {
    const session = requireAdmin(req, res);
    if (!session) return;
    try {
      const { title } = req.body || {};
      const trimmed = String(title || '').trim();
      if (!trimmed) {
        res.status(400).json({ error: 'Escribe un título.' });
        return;
      }
      const { data, error } = await supabase
        .from('news_posts')
        .insert({ title: trimmed, excerpt: 'Publicada desde el panel de administrador.' })
        .select()
        .single();
      if (error) throw error;
      res.status(201).json(newsToJson(data));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo publicar la noticia.' });
    }
    return;
  }

  res.status(405).json({ error: 'Método no permitido.' });
}
