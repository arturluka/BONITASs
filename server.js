import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, settings, uploadsDir } from './database/database.js';
import { requireAdmin, requireCsrf } from './middleware/auth.js';

const root=path.dirname(fileURLToPath(import.meta.url)); const app=express(); const production=process.env.NODE_ENV==='production';
const initialEmail=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase(), initialPassword=String(process.env.ADMIN_PASSWORD_INITIAL||'');
if(!db.prepare('SELECT 1 FROM admins LIMIT 1').get() && initialEmail.includes('@') && initialPassword.length>=10){
 const hash=await bcrypt.hash(initialPassword,12);
 db.prepare('INSERT INTO admins(name,email,password_hash) VALUES(?,?,?)').run('Administrador',initialEmail,hash);
 console.log('Administrador inicial criado a partir das variáveis de ambiente. Remova ADMIN_PASSWORD_INITIAL após o primeiro acesso.');
}
if(production) app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],imgSrc:["'self'",'data:','https://images.unsplash.com'],styleSrc:["'self'",'https://fonts.googleapis.com'],fontSrc:["'self'",'https://fonts.gstatic.com'],scriptSrc:["'self'"],connectSrc:["'self'"]}}}));
app.use(express.json({limit:'300kb'})); app.use(express.urlencoded({extended:false,limit:'50kb'}));
app.use(session({name:'bonitas.sid',secret:process.env.SESSION_SECRET||'development-only-change-this-long-secret',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:production,maxAge:1000*60*60*8}}));
app.use('/api/admin/login',rateLimit({windowMs:15*60*1000,limit:7,standardHeaders:'draft-8',legacyHeaders:false}));
app.use('/uploads',express.static(uploadsDir));
app.use(express.static(path.join(root,'public'),{extensions:['html']}));

const safeText=(v,max=200)=>String(v??'').trim().replace(/[<>\u0000-\u001F]/g,'').slice(0,max);
const money=v=>Number.isInteger(v)&&v>=0?v:null;
const productDTO=p=>{const images=db.prepare('SELECT url FROM product_images WHERE product_id=? ORDER BY is_primary DESC,sort_order').all(p.id).map(x=>x.url); const variants=db.prepare('SELECT id,size,color,stock FROM product_variants WHERE product_id=? ORDER BY id').all(p.id); return {...p,colors:JSON.parse(p.colors||'[]'),images,variants,total_stock:variants.reduce((a,v)=>a+v.stock,0)};};

app.get('/api/config',(req,res)=>res.json(settings()));
app.get('/api/products',(req,res)=>res.json(db.prepare('SELECT * FROM products WHERE active=1 ORDER BY created_at DESC').all().map(productDTO)));
app.get('/api/products/:slug',(req,res)=>{const p=db.prepare('SELECT * FROM products WHERE slug=? AND active=1').get(safeText(req.params.slug,100)); p?res.json(productDTO(p)):res.status(404).json({error:'Produto não encontrado.'});});

app.post('/api/orders',rateLimit({windowMs:10*60*1000,limit:12}), (req,res)=>{
 try{
  const b=req.body||{}, name=safeText(b.customer?.name,100), phone=String(b.customer?.phone||'').replace(/\D/g,''), email=safeText(b.customer?.email,150);
  if(name.length<3||phone.length<10||phone.length>13) return res.status(400).json({error:'Informe nome e WhatsApp válidos.'});
  if(!['pickup','delivery'].includes(b.fulfillment)||!['PIX','Dinheiro','Cartão de débito','Cartão de crédito'].includes(b.paymentMethod)) return res.status(400).json({error:'Escolha recebimento e pagamento.'});
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>30) return res.status(400).json({error:'Carrinho inválido.'});
  const cfg=settings(), prepared=[]; let subtotal=0;
  for(const raw of b.items){const id=Number(raw.variantId), qty=Number(raw.quantity); if(!Number.isInteger(id)||!Number.isInteger(qty)||qty<1||qty>20) throw new Error('Quantidade inválida.'); const v=db.prepare('SELECT v.*,p.name,p.price_cents,p.active FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=?').get(id); if(!v||!v.active||v.stock<qty) throw new Error(`${v?.name||'Produto'} sem estoque suficiente.`); subtotal+=v.price_cents*qty; prepared.push({...v,qty});}
  let discount=0,coupon=null; const code=safeText(b.coupon,30).toUpperCase(); if(code){coupon=db.prepare("SELECT * FROM coupons WHERE code=? AND active=1 AND (expires_at IS NULL OR expires_at>datetime('now')) AND (max_uses IS NULL OR uses<max_uses)").get(code); if(!coupon||subtotal<coupon.min_value_cents) throw new Error('Cupom inválido ou não aplicável.'); discount=coupon.type==='percent'?Math.round(subtotal*coupon.value/100):Math.min(coupon.value,subtotal);}
  let address=null, delivery=0; if(b.fulfillment==='delivery'){address={cep:safeText(b.address?.cep,9),street:safeText(b.address?.street,120),number:safeText(b.address?.number,20),complement:safeText(b.address?.complement,80),district:safeText(b.address?.district,80),city:safeText(b.address?.city,80),state:safeText(b.address?.state,2),reference:safeText(b.address?.reference,120)}; if(!address.cep||!address.street||!address.number||!address.district||!address.city||address.state.length!==2) throw new Error('Preencha o endereço completo.'); delivery=Number(cfg.delivery_fee_cents)||0;}
  const total=subtotal-discount+delivery; if(total<(Number(cfg.minimum_order_cents)||0)) throw new Error('Pedido abaixo do valor mínimo.');
  const create=db.transaction(()=>{const customer=db.prepare('INSERT INTO customers(name,phone,email) VALUES(?,?,?)').run(name,phone,email||null); const order=db.prepare('INSERT INTO orders(customer_id,fulfillment,address_json,payment_method,change_for_cents,subtotal_cents,discount_cents,delivery_cents,total_cents,coupon_code,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(customer.lastInsertRowid,b.fulfillment,address?JSON.stringify(address):null,b.paymentMethod,money(Number(b.changeForCents)),subtotal,discount,delivery,total,coupon?.code||null,safeText(b.notes,300)); const orderNumber=`BON-${String(order.lastInsertRowid).padStart(6,'0')}`; db.prepare('UPDATE orders SET order_number=? WHERE id=?').run(orderNumber,order.lastInsertRowid); db.prepare("INSERT INTO order_status_history(order_id,status) VALUES(?,'Novo')").run(order.lastInsertRowid); for(const x of prepared) db.prepare('INSERT INTO order_items(order_id,product_id,product_name,size,color,quantity,unit_price_cents) VALUES(?,?,?,?,?,?,?)').run(order.lastInsertRowid,x.product_id,x.name,x.size,x.color,x.qty,x.price_cents); if(coupon) db.prepare('UPDATE coupons SET uses=uses+1 WHERE id=?').run(coupon.id); return {id:order.lastInsertRowid,orderNumber};});
  const made=create(); res.status(201).json({...made,customer:{name,phone},fulfillment:b.fulfillment,address,paymentMethod:b.paymentMethod,items:prepared.map(x=>({name:x.name,size:x.size,color:x.color,quantity:x.qty,unitPriceCents:x.price_cents})),subtotalCents:subtotal,discountCents:discount,deliveryCents:delivery,totalCents:total,storeWhatsapp:cfg.whatsapp});
 }catch(e){res.status(400).json({error:e.message||'Não foi possível criar o pedido.'});}
});

app.post('/api/order-status',rateLimit({windowMs:15*60*1000,limit:12,standardHeaders:'draft-8',legacyHeaders:false}),(req,res)=>{
 const orderNumber=safeText(req.body?.orderNumber,20).toUpperCase(), phone=String(req.body?.phone||'').replace(/\D/g,'');
 if(!/^BON-\d{6,}$/.test(orderNumber)||phone.length<10||phone.length>13) return res.status(400).json({error:'Confira o número do pedido e o WhatsApp informado.'});
 const order=db.prepare('SELECT o.id,o.order_number,o.created_at,o.status,o.fulfillment,o.payment_method,o.subtotal_cents,o.discount_cents,o.delivery_cents,o.total_cents,c.name customer_name FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.order_number=? AND c.phone=?').get(orderNumber,phone);
 if(!order) return res.status(404).json({error:'Pedido não encontrado. Confira o número e use o mesmo WhatsApp informado na compra.'});
 const items=db.prepare('SELECT product_name,size,color,quantity,unit_price_cents FROM order_items WHERE order_id=? ORDER BY id').all(order.id);
 let history=db.prepare('SELECT status,created_at FROM order_status_history WHERE order_id=? ORDER BY id').all(order.id);
 if(!history.length) history=[{status:order.status,created_at:order.created_at}];
 res.json({orderNumber:order.order_number,createdAt:order.created_at,status:order.status,fulfillment:order.fulfillment,paymentMethod:order.payment_method,subtotalCents:order.subtotal_cents,discountCents:order.discount_cents,deliveryCents:order.delivery_cents,totalCents:order.total_cents,customerName:order.customer_name,items,history});
});

app.post('/api/admin/login',async(req,res)=>{const email=safeText(req.body.email,150).toLowerCase(), admin=db.prepare('SELECT * FROM admins WHERE email=?').get(email); if(!admin||!await bcrypt.compare(String(req.body.password||''),admin.password_hash)) return res.status(401).json({error:'E-mail ou senha incorretos.'}); req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Falha ao iniciar sessão.'}); req.session.adminId=admin.id; req.session.csrf=crypto.randomBytes(24).toString('hex'); res.json({name:admin.name,csrf:req.session.csrf});});});
app.get('/api/admin/me',requireAdmin,(req,res)=>{const a=db.prepare('SELECT id,name,email FROM admins WHERE id=?').get(req.session.adminId); if(!req.session.csrf) req.session.csrf=crypto.randomBytes(24).toString('hex'); res.json({...a,csrf:req.session.csrf});});
app.post('/api/admin/logout',requireAdmin,requireCsrf,(req,res)=>req.session.destroy(()=>res.json({ok:true})));

const storage=multer.diskStorage({destination:uploadsDir,filename:(req,file,cb)=>cb(null,`${Date.now()}-${crypto.randomBytes(10).toString('hex')}${file.mimetype==='image/png'?'.png':file.mimetype==='image/webp'?'.webp':'.jpg'}`)});
const upload=multer({storage,limits:{fileSize:5*1024*1024,files:6},fileFilter:(req,file,cb)=>cb(null,['image/jpeg','image/png','image/webp'].includes(file.mimetype))});
app.post('/api/admin/upload',requireAdmin,requireCsrf,upload.array('images',6),(req,res)=>res.json({urls:(req.files||[]).map(f=>`/uploads/${f.filename}`)}));

app.get('/api/admin/dashboard',requireAdmin,(req,res)=>{const row=db.prepare("SELECT COUNT(*) products,SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) available FROM products").get(); const stock=db.prepare('SELECT COALESCE(SUM(stock),0) stock_items FROM product_variants').get(); const orders=db.prepare("SELECT COUNT(*) orders_total,COALESCE(SUM(CASE WHEN status='Novo' THEN 1 ELSE 0 END),0) news,COALESCE(SUM(CASE WHEN status='Concluído' THEN total_cents ELSE 0 END),0) revenue FROM orders").get(); const recent=db.prepare('SELECT o.*,c.name customer_name FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.id DESC LIMIT 8').all(); const low=db.prepare('SELECT p.name,v.size,v.color,v.stock FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.stock<=? AND p.active=1 ORDER BY v.stock LIMIT 10').all(Number(settings().low_stock_limit)||3); res.json({...row,...stock,...orders,recent,low});});
app.get('/api/admin/products',requireAdmin,(req,res)=>res.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all().map(productDTO)));

function validateProduct(b){const name=safeText(b.name,120),category=safeText(b.category,60),slug=(safeText(b.slug||name,130).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')).slice(0,100),price=Number(b.price_cents),old=b.old_price_cents==null||b.old_price_cents===''?null:Number(b.old_price_cents),description=safeText(b.description,2000),colors=Array.isArray(b.colors)?b.colors.map(x=>safeText(x,30)).filter(Boolean).slice(0,12):[]; if(name.length<2||!category||!slug||!Number.isInteger(price)||price<0||price>100000000) throw new Error('Dados do produto inválidos.'); const variants=Array.isArray(b.variants)?b.variants:[]; for(const v of variants){if(!['PP','P','M','G','GG'].includes(v.size)||!colors.includes(v.color)||!Number.isInteger(Number(v.stock))||Number(v.stock)<0) throw new Error('Variação inválida.');} return {name,category,slug,price,old,description,colors,variants,featured:b.featured?1:0,novelty:b.novelty?1:0,active:b.active===false?0:1,images:Array.isArray(b.images)?b.images.filter(x=>/^\/uploads\/[\w.-]+$|^https:\/\//.test(x)).slice(0,8):[]};}
const saveProduct=(id,b)=>{const p=validateProduct(b); return db.transaction(()=>{let pid=id;if(id){db.prepare('UPDATE products SET slug=?,name=?,category=?,description=?,price_cents=?,old_price_cents=?,colors=?,featured=?,novelty=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(p.slug,p.name,p.category,p.description,p.price,p.old,JSON.stringify(p.colors),p.featured,p.novelty,p.active,id); db.prepare('DELETE FROM product_variants WHERE product_id=?').run(id); db.prepare('DELETE FROM product_images WHERE product_id=?').run(id);}else pid=Number(db.prepare('INSERT INTO products(slug,name,category,description,price_cents,old_price_cents,colors,featured,novelty,active) VALUES(?,?,?,?,?,?,?,?,?,?)').run(p.slug,p.name,p.category,p.description,p.price,p.old,JSON.stringify(p.colors),p.featured,p.novelty,p.active).lastInsertRowid); p.images.forEach((url,i)=>db.prepare('INSERT INTO product_images(product_id,url,is_primary,sort_order) VALUES(?,?,?,?)').run(pid,url,i===0?1:0,i)); p.variants.forEach(v=>db.prepare('INSERT INTO product_variants(product_id,size,color,stock) VALUES(?,?,?,?)').run(pid,v.size,v.color,Number(v.stock))); return productDTO(db.prepare('SELECT * FROM products WHERE id=?').get(pid));})();};
app.post('/api/admin/products',requireAdmin,requireCsrf,(req,res)=>{try{res.status(201).json(saveProduct(null,req.body));}catch(e){res.status(400).json({error:e.message});}});
app.put('/api/admin/products/:id',requireAdmin,requireCsrf,(req,res)=>{try{res.json(saveProduct(Number(req.params.id),req.body));}catch(e){res.status(400).json({error:e.message});}});
app.delete('/api/admin/products/:id',requireAdmin,requireCsrf,(req,res)=>{db.prepare('UPDATE products SET active=0 WHERE id=?').run(Number(req.params.id));res.json({ok:true});});
app.post('/api/admin/products/:id/duplicate',requireAdmin,requireCsrf,(req,res)=>{const p=productDTO(db.prepare('SELECT * FROM products WHERE id=?').get(Number(req.params.id))); if(!p)return res.status(404).json({error:'Produto não encontrado.'}); try{res.status(201).json(saveProduct(null,{...p,name:`${p.name} (cópia)`,slug:`${p.slug}-copia-${Date.now()}`,images:p.images,variants:p.variants}));}catch(e){res.status(400).json({error:e.message});}});

app.get('/api/admin/orders',requireAdmin,(req,res)=>res.json(db.prepare('SELECT o.*,c.name customer_name,c.phone FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.id DESC').all()));
app.get('/api/admin/orders/:id',requireAdmin,(req,res)=>{const o=db.prepare('SELECT o.*,c.name customer_name,c.phone,c.email FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?').get(Number(req.params.id)); if(!o)return res.status(404).json({error:'Pedido não encontrado.'}); o.items=db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id);res.json(o);});
app.patch('/api/admin/orders/:id/status',requireAdmin,requireCsrf,(req,res)=>{const statuses=['Novo','Confirmado','Preparando','Disponível para retirada','Saiu para entrega','Concluído','Cancelado'], status=safeText(req.body.status,40); if(!statuses.includes(status))return res.status(400).json({error:'Status inválido.'}); try{db.transaction(()=>{const o=db.prepare('SELECT * FROM orders WHERE id=?').get(Number(req.params.id)); if(!o)throw new Error('Pedido não encontrado.'); if(status==='Confirmado'&&!o.stock_deducted){for(const i of db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id)){const r=db.prepare('UPDATE product_variants SET stock=stock-? WHERE product_id=? AND size=? AND color=? AND stock>=?').run(i.quantity,i.product_id,i.size,i.color,i.quantity);if(!r.changes)throw new Error(`Estoque insuficiente para ${i.product_name}.`);}db.prepare('UPDATE orders SET stock_deducted=1 WHERE id=?').run(o.id);} if(o.status!==status){db.prepare('UPDATE orders SET status=? WHERE id=?').run(status,o.id);db.prepare('INSERT INTO order_status_history(order_id,status) VALUES(?,?)').run(o.id,status);}})();res.json({ok:true,status});}catch(e){res.status(400).json({error:e.message});}});

app.get('/api/admin/coupons',requireAdmin,(req,res)=>res.json(db.prepare('SELECT * FROM coupons ORDER BY id DESC').all()));
app.post('/api/admin/coupons',requireAdmin,requireCsrf,(req,res)=>{const b=req.body,code=safeText(b.code,30).toUpperCase(),type=b.type,value=Number(b.value),min=Number(b.min_value_cents)||0,max=b.max_uses?Number(b.max_uses):null;if(!/^[A-Z0-9_-]{3,30}$/.test(code)||!['percent','fixed'].includes(type)||!Number.isInteger(value)||value<1)return res.status(400).json({error:'Cupom inválido.'});try{const r=db.prepare('INSERT INTO coupons(code,type,value,expires_at,max_uses,min_value_cents,active) VALUES(?,?,?,?,?,?,?)').run(code,type,value,b.expires_at||null,max,min,b.active===false?0:1);res.status(201).json({id:r.lastInsertRowid});}catch{res.status(400).json({error:'Código já cadastrado.'});}});
app.delete('/api/admin/coupons/:id',requireAdmin,requireCsrf,(req,res)=>{db.prepare('UPDATE coupons SET active=0 WHERE id=?').run(Number(req.params.id));res.json({ok:true});});
app.put('/api/admin/settings',requireAdmin,requireCsrf,(req,res)=>{const allowed=['store_name','whatsapp','instagram','address','delivery_fee_cents','low_stock_limit','opening_hours','minimum_order_cents'];const run=db.transaction(()=>{for(const k of allowed)if(k in req.body)db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,safeText(req.body[k],300));});run();res.json(settings());});

app.get('/admin',(req,res)=>res.sendFile(path.join(root,'public','admin','index.html')));
app.get('/admin/*splat',(req,res)=>res.sendFile(path.join(root,'public','admin','index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(err instanceof multer.MulterError?400:500).json({error:err instanceof multer.MulterError?'Imagem inválida ou muito grande.':'Erro interno.'});});
app.listen(Number(process.env.PORT)||3000,()=>console.log(`BONITAS: http://localhost:${Number(process.env.PORT)||3000}`));
