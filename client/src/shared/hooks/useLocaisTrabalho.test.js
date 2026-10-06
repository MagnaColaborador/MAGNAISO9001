import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { apiFetch } from "../utils/apiFetch";
import { useLocaisTrabalho } from "./useLocaisTrabalho";

jest.mock("../utils/apiFetch", () => ({ apiFetch: jest.fn() }));

const LOCAIS = [{ nome: "Porto", morada: "Rua A" }, { nome: "Abrantes", morada: "Praça B" }];

function Lista({ id }) {
  const { nomes, labels } = useLocaisTrabalho();
  return <div data-testid={id}>{nomes.map((n) => labels[n]).join("|")}</div>;
}

test("vários componentes partilham um único pedido a /config/locais-trabalho", async () => {
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({ locaisTrabalho: LOCAIS }) });

  const { rerender } = render(<><Lista id="a" /><Lista id="b" /></>);
  await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("Porto - Rua A|Abrantes - Praça B"));
  expect(screen.getByTestId("b").textContent).toBe("Porto - Rua A|Abrantes - Praça B");

  // Um componente montado mais tarde reutiliza a cache, sem novo pedido.
  rerender(<><Lista id="a" /><Lista id="b" /><Lista id="c" /></>);
  expect(screen.getByTestId("c").textContent).toBe("Porto - Rua A|Abrantes - Praça B");

  expect(apiFetch).toHaveBeenCalledTimes(1);
  expect(apiFetch).toHaveBeenCalledWith("/config/locais-trabalho");
});
