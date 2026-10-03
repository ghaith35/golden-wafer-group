import { createSecteur, listSecteurs } from "@/lib/settings/list-routes";

export async function GET() {
  return listSecteurs();
}

export async function POST(req: Request) {
  return createSecteur(req);
}
