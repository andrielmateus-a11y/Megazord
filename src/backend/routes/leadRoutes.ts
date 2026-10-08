import { Router } from 'express';
import * as c from '../controllers/leadController.js';

export const leadRoutes = Router()
  .get('/', c.list)
  .get('/opt-outs', c.listOptOuts)
  .post('/opt-outs', c.optOut)
  .delete('/opt-outs/:id', c.removeOptOut)
  .get('/:id', c.get)
  .patch('/:id', c.update)
  .post('/:id/notes', c.addNote);
