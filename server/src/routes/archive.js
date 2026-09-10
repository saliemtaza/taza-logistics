import { Router } from 'express';
import { previewArchive, runArchive, listArchiveFiles, getArchiveFileBuffer } from '../services/archive.js';

export const archiveRouter = Router();

archiveRouter.get('/preview', async (req, res) => {
  const { before } = req.query;
  if (!before) return res.status(400).json({ error: 'before query param required (YYYY-MM-DD)' });
  res.json(await previewArchive(before));
});

archiveRouter.post('/run', async (req, res) => {
  const { before } = req.body;
  if (!before) return res.status(400).json({ error: 'before required (YYYY-MM-DD)' });
  res.json(await runArchive(before));
});

archiveRouter.get('/files', async (req, res) => {
  res.json(await listArchiveFiles());
});

archiveRouter.get('/files/:filename', async (req, res) => {
  try {
    const buffer = await getArchiveFileBuffer(req.params.filename);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});
