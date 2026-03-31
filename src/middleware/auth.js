import jwt from 'jsonwebtoken';
import { cfg } from '../config.js';

export function authMiddleware(req, res, next){
  try{
    const auth = req.headers.authorization || '';
    if(!auth.startsWith('Bearer ')){
      return res.status(401).json({ error:'No token' });
    }
    const token = auth.slice(7);
    const payload = jwt.verify(token, cfg.jwtSecret);
    req.user = payload;
    next();
  }catch(e){
    return res.status(401).json({ error:'Invalid token' });
  }
}

export const authRequired = authMiddleware;
