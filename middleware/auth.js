export function requireAdmin(req,res,next){ if(!req.session?.adminId) return res.status(401).json({error:'Faça login para continuar.'}); next(); }
export function requireCsrf(req,res,next){ if(!req.session?.csrf || req.get('x-csrf-token')!==req.session.csrf) return res.status(403).json({error:'Sessão inválida. Atualize a página.'}); next(); }
