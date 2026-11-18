<script remote lang="ts">
export const getCount = () => 42;
export async function bump(by: number): Promise<number> {
	return 42 + by;
}
</script>

<script lang="ts">
	let n = $state(0);
</script>

<p>{n}</p>
