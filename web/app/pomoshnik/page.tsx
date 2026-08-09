import { AgentConsole } from "@/components/agent/AgentConsole";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Помощник — MedPrice.kz",
  description:
    "Покажите назначение врача, найдем, где купить дешевле рядом, и посчитаем курс",
};

export default function AssistantPage() {
  return (
    <main className="min-h-[calc(100vh-4rem)]">
      <AgentConsole />
    </main>
  );
}
