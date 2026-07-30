update public.subcategories as subcategory
set food_characteristic = 'necessary'
from public.categories as category
where subcategory.category_id = category.id
  and subcategory.household_id = category.household_id
  and lower(trim(category.name)) = 'alimentari'
  and subcategory.food_characteristic is null;
