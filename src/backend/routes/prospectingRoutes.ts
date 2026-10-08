import { Router } from 'express';
import * as c from '../controllers/prospectingController.js';

// /api/companies — prospecção e empresas
export const companyRoutes = Router()
  .post('/discover', c.discover)
  .post('/discover/next', c.next)
  .get('/recent', c.recent)
  .get('/check/:cnpj', c.checkCnpj)
  .post('/:cnpj/contacts/fetch', c.fetchContacts)
  .post('/cache/clear', c.clearCache)
  .get('/:id', c.getCompany)
  .post('/:id/contacts', c.addContact);

// /api/contacts
export const contactRoutes = Router().patch('/:id', c.updateContact);
