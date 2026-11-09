import { BookmarkletInstall } from "@/components/capture-controls";
import { requireUser } from "@/lib/auth";
import { APP_NAME } from "@/lib/app-name";
import { bookmarklet } from "@/lib/bookmarklet";

export default async function BookmarkletPage() {
  await requireUser();
  const code = bookmarklet(process.env.APP_URL ?? "http://localhost:3000");
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Stuur naar {APP_NAME}</h1>
        <p className="text-sm text-stone-500">
          Een bladwijzer die de advertentie die je bekijkt naar de app stuurt, bv. op Huislijn, Pararius of de site van een
          makelaar. Die sites laten onze server niet binnen, maar jij kunt ze gewoon openen; zo komen de gegevens toch bij
          Claude.
        </p>
      </div>
      <BookmarkletInstall code={code} name={APP_NAME} />
    </div>
  );
}
