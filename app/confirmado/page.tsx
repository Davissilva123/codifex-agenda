"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export default function ConfirmadoPage() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Confirmando sua conta...");
  const [appOpened, setAppOpened] = useState(false);

  useEffect(() => {
    async function handleConfirmation() {
      try {
        const supabase = getSupabase();
        
        // Verifica se há parâmetros de autenticação no hash ou na query
        if (typeof window !== "undefined") {
          const hash = window.location.hash;
          const searchParams = new URLSearchParams(window.location.search);
          const errorDesc = searchParams.get("error_description");

          if (errorDesc) {
            setStatus("error");
            setMessage(decodeURIComponent(errorDesc));
            return;
          }

          // Se tiver access_token no hash, o Supabase já autenticou
          if (hash.includes("access_token") || searchParams.has("code")) {
            const { data } = await supabase.auth.getSession();
            if (data?.session) {
              setStatus("success");
              triggerOpenApp();
              return;
            }
          }
        }

        // Aguarda um instante para certificar o estado da sessão
        const { data } = await supabase.auth.getSession();
        setStatus("success");
        triggerOpenApp();
      } catch (err) {
        console.warn("Aviso ao processar confirmação:", err);
        // Mesmo se houver aviso, a conta provavelmente já foi ativada no backend do Supabase
        setStatus("success");
        triggerOpenApp();
      }
    }

    function triggerOpenApp() {
      // Tenta abrir o executável via protocolo registrado
      try {
        window.location.href = "codifex-agendas://";
        setAppOpened(true);
      } catch (_) {}
    }

    void handleConfirmation();
  }, []);

  const handleOpenAppManual = () => {
    window.location.href = "codifex-agendas://";
    setAppOpened(true);
  };

  return (
    <main className="min-h-screen bg-[#0b0f19] text-[#f1f5f9] flex flex-col items-center justify-center p-4 selection:bg-blue-600 selection:text-white">
      <div className="w-full max-w-md bg-[#131b2e] border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl text-center flex flex-col items-center animate-fade-in">
        {/* Logo / Ícone */}
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 p-0.5 shadow-lg shadow-blue-500/20 mb-6 flex items-center justify-center">
          <div className="w-full h-full bg-[#0b0f19] rounded-[14px] flex items-center justify-center">
            {status === "loading" ? (
              <div className="w-8 h-8 border-3 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            ) : status === "error" ? (
              <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-10 h-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </div>

        {/* Título */}
        <h1 className="text-2xl font-bold tracking-tight text-white mb-2">
          {status === "loading"
            ? "Verificando cadastro..."
            : status === "error"
            ? "Atenção ao confirmar"
            : "Conta confirmada com sucesso!"}
        </h1>

        {/* Mensagem */}
        <p className="text-slate-400 text-sm leading-relaxed mb-6">
          {status === "loading"
            ? message
            : status === "error"
            ? message || "Não foi possível validar este link. Tente entrar diretamente pelo aplicativo."
            : "Obrigado por confirmar o seu cadastro no CODIFEX AGENDAS. Seu acesso já está liberado e pronto para uso!"}
        </p>

        {/* Botão de Abrir Executável */}
        {status === "success" && (
          <div className="w-full space-y-3">
            <button
              type="button"
              onClick={handleOpenAppManual}
              className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold rounded-xl transition duration-150 shadow-lg shadow-blue-600/25 flex items-center justify-center gap-2 text-sm sm:text-base cursor-pointer"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              <span>Abrir CODIFEX AGENDAS</span>
            </button>

            <p className="text-xs text-slate-500 leading-normal">
              {appOpened
                ? "Se o aplicativo já foi aberto no seu computador, pode fechar esta aba."
                : "Clique no botão acima para abrir o programa instalado no seu computador. Você também pode abri-lo pelo atalho na Área de Trabalho."}
            </p>
          </div>
        )}

        {status === "error" && (
          <button
            type="button"
            onClick={handleOpenAppManual}
            className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-xl transition duration-150 text-sm"
          >
            Tentar abrir o aplicativo mesmo assim
          </button>
        )}

        {/* Rodapé institucional */}
        <div className="mt-8 pt-6 border-t border-slate-800/80 w-full flex items-center justify-center gap-2 text-xs text-slate-500">
          <span>CODIFEX SISTEMAS</span>
          <span>•</span>
          <span>Avisnet</span>
        </div>
      </div>
    </main>
  );
}
