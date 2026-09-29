// Configuração pública do app Vizzani.
// Só a URL do projeto e a chave publishable (pode ficar no front-end).
// NUNCA colocar aqui a secret key / service_role.
window.VIZZANI_CONFIG = {
  supabaseUrl: 'https://gahfdxvikogmtavwfkgo.supabase.co',
  supabaseKey: 'sb_publishable_daf7JEkG-WVm8jSFiArFhQ_nw-h97tb',
  // Chave PÚBLICA dos avisos no celular (Web Push). A privada fica só nos segredos do Supabase.
  vapidPublicKey: 'BGN1lQMhLVUGQtzbJ0EyozwT6wbXWGDp45u0zFbZgRwFcJKg1KyHbOA2Bxf_o_9g4EM4ATk4pjd9yd9YwgE7EO4',
};
